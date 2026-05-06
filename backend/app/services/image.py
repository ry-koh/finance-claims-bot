"""
Image processing service.

Handles receipt and bank-screenshot images submitted through the Telegram bot
using Pillow.  Responsibilities include:
- Validating uploaded image formats and file sizes.
- Converting HEIC/PDF to JPEG with graceful fallback errors.
- Normalising images to A4 dimensions at 150 DPI.
- Returning processed image bytes ready for Google Drive upload or PDF embedding.
"""

import io

SUPPORTED_MIME_TYPES = {
    'image/jpeg', 'image/jpg', 'image/png',
    'image/heic', 'image/heif', 'image/webp',
    'application/pdf'
}

SUPPORTED_EXTENSIONS = {'.heic', '.heif', '.webp', '.jpg', '.jpeg', '.png', '.pdf'}

# A4 at 150 DPI
A4_WIDTH_PX = 1240
A4_HEIGHT_PX = 1754


def validate_mime_type(content_type: str, filename: str) -> None:
    normalised_ct = (content_type or "").lower().split(";")[0].strip()
    if normalised_ct in SUPPORTED_MIME_TYPES:
        return
    if filename:
        lower_name = filename.lower()
        for ext in SUPPORTED_EXTENSIONS:
            if lower_name.endswith(ext):
                return
    raise ValueError(
        f"Unsupported file type '{content_type}'. "
        f"Please upload a JPEG, PNG, HEIC, WEBP, or single-page PDF."
    )


def convert_to_jpeg(file_bytes: bytes, content_type: str) -> bytes:
    from PIL import Image  # lazy import
    normalised_ct = (content_type or "").lower().split(";")[0].strip()
    is_heic = normalised_ct in ('image/heic', 'image/heif')
    is_pdf = normalised_ct == 'application/pdf'

    if is_heic:
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            raise ValueError("HEIC files require pillow-heif. Please convert to JPEG first.")
        img = Image.open(io.BytesIO(file_bytes))
    elif is_pdf:
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise ValueError(
                "PDF conversion unavailable on this server. "
                "Please upload receipt as a JPEG or PNG image."
            )
        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            if doc.page_count == 0:
                raise ValueError("PDF contained no pages.")
            page = doc[0]
            mat = fitz.Matrix(2.0, 2.0)
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        except ValueError:
            raise
        except Exception:
            raise ValueError(
                "PDF conversion unavailable on this server. "
                "Please upload receipt as a JPEG or PNG image."
            )
    else:
        img = Image.open(io.BytesIO(file_bytes))

    if img.mode == 'RGBA':
        background = Image.new('RGB', img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        img = background
    elif img.mode != 'RGB':
        img = img.convert('RGB')

    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=85)
    return buf.getvalue()


_MAX_STORAGE_BYTES = 400 * 1024  # 400 KB target for stored images


def _compress_to_target(img) -> bytes:
    for quality in (85, 75, 65, 55):
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=quality, optimize=True)
        data = buf.getvalue()
        if len(data) <= _MAX_STORAGE_BYTES or quality == 55:
            return data
    return data


def normalise_to_a4(jpeg_bytes: bytes) -> bytes:
    from PIL import Image  # lazy import
    img = Image.open(io.BytesIO(jpeg_bytes))

    if img.mode != 'RGB':
        img = img.convert('RGB')

    # Scale to fill A4 (up or down), preserving aspect ratio and orientation
    scale = min(A4_WIDTH_PX / img.width, A4_HEIGHT_PX / img.height)
    new_w = int(img.width * scale)
    new_h = int(img.height * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new('RGB', (A4_WIDTH_PX, A4_HEIGHT_PX), (255, 255, 255))
    canvas.paste(img, ((A4_WIDTH_PX - new_w) // 2, (A4_HEIGHT_PX - new_h) // 2))
    return _compress_to_target(canvas)


def process_receipt_image(file_bytes: bytes, content_type: str, filename: str) -> bytes:
    validate_mime_type(content_type, filename)
    jpeg_bytes = convert_to_jpeg(file_bytes, content_type)
    return normalise_to_a4(jpeg_bytes)


def process_pdf_pages(file_bytes: bytes) -> list[bytes]:
    """Convert every page of a PDF to a normalised JPEG. Returns a list of JPEG bytes."""
    from PIL import Image  # lazy import
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise ValueError("PDF conversion unavailable on this server.")

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception:
        raise ValueError("Could not open PDF.")

    if doc.page_count == 0:
        raise ValueError("PDF contained no pages.")

    results = []
    mat = fitz.Matrix(2.0, 2.0)
    for page in doc:
        pix = page.get_pixmap(matrix=mat)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=85)
        results.append(normalise_to_a4(buf.getvalue()))
    return results
