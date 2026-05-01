"""
PDF generation service.

Produces the standardised claim documents required by the Finance Director
using fpdf2 and pypdf.  Responsibilities include:
- Generating the Letter of Authorisation (LOA) PDF.
- Generating the claim summary sheet with line-item breakdown and totals.
- Generating the Request for Payment (RFP) form.
- Generating the transport claim form when transport_form_needed is True.
- Compiling individual documents into a single merged PDF for email submission.
- Uploading generated PDFs to Google Drive via the drive service and recording
  the resulting ClaimDocument rows in Supabase.
"""

from fpdf import FPDF
from PIL import Image
import io, os, tempfile, logging
from googleapiclient.http import MediaIoBaseDownload
from app.services.drive import get_drive_service
from app.config import settings

logger = logging.getLogger(__name__)

# A4 dimensions in mm
A4_W = 210
A4_H = 297
MARGIN = 15  # mm margins on all sides
CONTENT_W = A4_W - 2 * MARGIN
CONTENT_H = A4_H - 2 * MARGIN


def download_drive_file(file_id: str) -> bytes:
    """
    Download file bytes from Google Drive by file ID using the Drive API.
    Raises ValueError if the file is not found or cannot be downloaded.
    """
    drive_service = get_drive_service()
    try:
        request = drive_service.files().get_media(fileId=file_id)
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buffer.getvalue()
    except Exception as exc:
        raise ValueError(f"Could not download Drive file {file_id}: {exc}") from exc


def generate_loa(claim: dict, receipts: list) -> bytes:
    """
    Generate a Letter of Authorisation (LOA) PDF for the given claim.

    Parameters
    ----------
    claim : dict
        Keys: reference_code, date, claim_description,
              claimer (nested dict with name, matric_no)
    receipts : list[dict]
        Each dict has: description, company, date, amount,
                       receipt_image_drive_id, bank_screenshot_drive_id

    Returns
    -------
    bytes
        Raw PDF bytes ready for upload or streaming.
    """
    pdf = FPDF(orientation='P', unit='mm', format='A4')
    pdf.set_auto_page_break(False)

    # ------------------------------------------------------------------
    # Cover page
    # ------------------------------------------------------------------
    pdf.add_page()

    claimer = claim.get("claimer", {}) or {}
    claimer_name = claimer.get("name", "Unknown")
    matric_no = claimer.get("matric_no", "")
    claimer_line = claimer_name
    if matric_no:
        claimer_line = f"{claimer_name}  |  {matric_no}"

    # Title
    pdf.set_font("Helvetica", style="B", size=16)
    pdf.set_xy(MARGIN, 40)
    pdf.cell(CONTENT_W, 10, "LETTER OF AUTHORISATION", align="C", ln=True)

    # Reference code
    pdf.set_font("Helvetica", style="B", size=14)
    pdf.set_xy(MARGIN, 60)
    pdf.cell(CONTENT_W, 8, str(claim.get("reference_code", "")), align="C", ln=True)

    # Claim description
    pdf.set_font("Helvetica", style="", size=11)
    pdf.set_xy(MARGIN, 75)
    pdf.cell(CONTENT_W, 7, str(claim.get("claim_description", "")), align="C", ln=True)

    # Claimer name + matric
    pdf.set_font("Helvetica", style="", size=11)
    pdf.set_xy(MARGIN, 90)
    pdf.cell(CONTENT_W, 7, claimer_line, align="C", ln=True)

    # Date
    pdf.set_font("Helvetica", style="", size=10)
    pdf.set_xy(MARGIN, 105)
    pdf.cell(CONTENT_W, 6, str(claim.get("date", "")), align="C", ln=True)

    # Count images that will actually be attached
    image_count = 0
    for receipt in (receipts or []):
        if receipt.get("receipt_image_drive_id"):
            image_count += 1
        if receipt.get("bank_screenshot_drive_id"):
            image_count += 1

    if image_count > 0:
        # Intro line
        pdf.set_font("Helvetica", style="I", size=10)
        pdf.set_xy(MARGIN, 125)
        pdf.cell(CONTENT_W, 6, "The following receipt images are attached below:", align="C", ln=True)

        # Receipt count
        pdf.set_font("Helvetica", style="", size=10)
        pdf.set_xy(MARGIN, 135)
        pdf.cell(CONTENT_W, 6, f"Total receipts: {len(receipts or [])}", align="C", ln=True)
    else:
        pdf.set_font("Helvetica", style="I", size=10)
        pdf.set_xy(MARGIN, 125)
        pdf.cell(CONTENT_W, 6, "No receipt images attached.", align="C", ln=True)

    # ------------------------------------------------------------------
    # Receipt image pages
    # ------------------------------------------------------------------
    for receipt in (receipts or []):
        drive_ids = [
            ("receipt", receipt.get("receipt_image_drive_id")),
            ("bank",    receipt.get("bank_screenshot_drive_id")),
        ]
        for img_type, drive_id in drive_ids:
            if not drive_id:
                continue

            # Header label for this page
            desc = str(receipt.get("description") or "Receipt")
            amount_raw = receipt.get("amount")
            amount_str = f"SGD {amount_raw}" if amount_raw is not None else ""
            if img_type == "bank":
                header_label = f"[Bank screenshot]  {desc}  {amount_str}".strip()
            else:
                header_label = f"{desc}  {amount_str}".strip()

            try:
                file_bytes = download_drive_file(drive_id)
                img = Image.open(io.BytesIO(file_bytes))

                # Convert pixels to mm at 150 DPI
                px_per_mm = 150 / 25.4
                width_mm = img.width / px_per_mm
                height_mm = img.height / px_per_mm

                # Scale to fit within CONTENT_W × (CONTENT_H - 8mm header)
                available_h = CONTENT_H - 8  # reserve 8 mm for header
                scale = min(
                    CONTENT_W / width_mm if width_mm > 0 else 1,
                    available_h / height_mm if height_mm > 0 else 1,
                    1.0,  # never upscale
                )
                scaled_w = width_mm * scale
                scaled_h = height_mm * scale

                # Determine image format for saving to temp file
                img_format = img.format or "PNG"
                if img_format.upper() == "JPEG":
                    suffix = ".jpg"
                elif img_format.upper() == "PNG":
                    suffix = ".png"
                else:
                    # Convert to PNG for safety
                    img_format = "PNG"
                    suffix = ".png"

                pdf.add_page()

                # Small grey header at top
                pdf.set_font("Helvetica", style="", size=8)
                pdf.set_text_color(120, 120, 120)
                pdf.set_xy(MARGIN, MARGIN)
                pdf.cell(CONTENT_W, 6, header_label, align="L", ln=True)
                pdf.set_text_color(0, 0, 0)

                # Save image to temp file and embed
                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    tmp_path = tmp.name
                try:
                    img.save(tmp_path, format=img_format)
                    x_pos = MARGIN + (CONTENT_W - scaled_w) / 2
                    y_pos = MARGIN + 8
                    pdf.image(tmp_path, x=x_pos, y=y_pos, w=scaled_w, h=scaled_h)
                finally:
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

            except Exception as exc:
                logger.warning(
                    "Failed to embed image for drive_id=%s receipt=%s: %s",
                    drive_id, desc, exc
                )
                pdf.add_page()
                pdf.set_font("Helvetica", style="I", size=10)
                pdf.set_text_color(180, 0, 0)
                pdf.set_xy(MARGIN, MARGIN + 30)
                pdf.cell(
                    CONTENT_W, 8,
                    f"[Image unavailable: {header_label}]",
                    align="C", ln=True
                )
                pdf.set_text_color(0, 0, 0)

    return bytes(pdf.output())
