"""
Image processing service.

Handles receipt and bank-screenshot images submitted through the Telegram bot
using Pillow.  Responsibilities include:
- Validating uploaded image formats and file sizes.
- Converting HEIC/PDF to JPEG with graceful fallback errors.
- Normalising images to A4 dimensions at 150 DPI.
- Returning processed image bytes ready for Google Drive upload or PDF embedding.
"""

from PIL import Image
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
    """
    Raises ValueError with a clear message if the file type is not supported.
    Checks MIME type first, then falls back to file extension.
    """
    normalised_ct = (content_type or "").lower().split(";")[0].strip()

    if normalised_ct in SUPPORTED_MIME_TYPES:
        return

    # Fallback: check file extension
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
    """
    Convert uploaded file bytes to JPEG bytes.

    - HEIC/HEIF: uses pillow-heif if available, otherwise raises ValueError.
    - PDF: uses pdf2image if available, otherwise raises ValueError.
    - All others: opened directly with Pillow.
    - RGBA images are composited onto a white background before conversion.

    Returns JPEG bytes at quality=85.
    """
    normalised_ct = (content_type or "").lower().split(";")[0].strip()
    is_heic = normalised_ct in ('image/heic', 'image/heif')
    is_pdf = normalised_ct == 'application/pdf'

    if is_heic:
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            raise ValueError(
                "HEIC files require pillow-heif. Please convert to JPEG first."
            )
        img = Image.open(io.BytesIO(file_bytes))

    elif is_pdf:
        try:
            from pdf2image import convert_from_bytes as pdf_convert
        except ImportError:
            raise ValueError(
                "PDF conversion unavailable on this server. "
                "Please upload receipt as a JPEG or PNG image."
            )
        try:
            pages = pdf_convert(file_bytes, first_page=1, last_page=1)
        except Exception:
            raise ValueError(
                "PDF conversion unavailable on this server. "
                "Please upload receipt as a JPEG or PNG image."
            )
        if not pages:
            raise ValueError("Could not extract any pages from the PDF.")
        img = pages[0]

    else:
        img = Image.open(io.BytesIO(file_bytes))

    # Convert to RGB (handle RGBA by compositing onto white)
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


def _compress_to_target(img: Image.Image) -> bytes:
    """Save img as JPEG, stepping down quality until ≤ 400 KB or quality floor reached."""
    for quality in (85, 75, 65, 55):
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=quality, optimize=True)
        data = buf.getvalue()
        if len(data) <= _MAX_STORAGE_BYTES or quality == 55:
            return data
    return data


def normalise_to_a4(jpeg_bytes: bytes) -> bytes:
    """
    Normalise JPEG bytes to fit within an A4 canvas at 150 DPI.

    - Landscape images (wider than tall) are rotated 90° counterclockwise.
    - Image is scaled down to fit within A4_WIDTH_PX × A4_HEIGHT_PX while
      preserving aspect ratio (never upscaled).
    - Placed centred on a white A4 canvas.
    - Compressed adaptively to target ≤ 400 KB.
    """
    img = Image.open(io.BytesIO(jpeg_bytes))

    # Ensure RGB
    if img.mode != 'RGB':
        img = img.convert('RGB')

    # Rotate landscape images to portrait
    if img.width > img.height:
        img = img.rotate(90, expand=True)

    # Scale to fit within A4, only downscale — never upscale
    scale = min(
        A4_WIDTH_PX / img.width,
        A4_HEIGHT_PX / img.height,
        1.0  # cap at 1.0 to prevent upscaling
    )
    new_w = int(img.width * scale)
    new_h = int(img.height * scale)

    if scale < 1.0:
        img = img.resize((new_w, new_h), Image.LANCZOS)

    # Create white A4 canvas and paste centred
    canvas = Image.new('RGB', (A4_WIDTH_PX, A4_HEIGHT_PX), (255, 255, 255))
    x_offset = (A4_WIDTH_PX - img.width) // 2
    y_offset = (A4_HEIGHT_PX - img.height) // 2
    canvas.paste(img, (x_offset, y_offset))

    return _compress_to_target(canvas)


def process_receipt_image(file_bytes: bytes, content_type: str, filename: str) -> bytes:
    """
    Full pipeline: validate → convert to JPEG → normalise to A4.
    Returns final JPEG bytes.
    """
    validate_mime_type(content_type, filename)
    jpeg_bytes = convert_to_jpeg(file_bytes, content_type)
    return normalise_to_a4(jpeg_bytes)
