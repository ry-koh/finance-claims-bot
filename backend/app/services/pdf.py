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
import io, os, tempfile, logging, time
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from app.services import r2 as r2_service
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
    Download file bytes from Google Drive by file ID using user OAuth credentials.
    Raises ValueError if the file is not found or cannot be downloaded.
    """
    drive_service = build('drive', 'v3', credentials=_get_user_drive_credentials(), cache_discovery=False)
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


def _add_image_page(pdf: FPDF, drive_id: str, header_label: str) -> None:
    """Download an R2 image and embed it on a new PDF page with a header label."""
    try:
        file_bytes = r2_service.download_file(drive_id)
        img = Image.open(io.BytesIO(file_bytes))

        px_per_mm = 150 / 25.4
        width_mm = img.width / px_per_mm
        height_mm = img.height / px_per_mm

        available_h = CONTENT_H - 8
        scale = min(
            CONTENT_W / width_mm if width_mm > 0 else 1,
            available_h / height_mm if height_mm > 0 else 1,
            1.0,
        )
        scaled_w = width_mm * scale
        scaled_h = height_mm * scale

        img_format = img.format or "PNG"
        suffix = ".jpg" if img_format.upper() == "JPEG" else ".png"
        if img_format.upper() not in ("JPEG", "PNG"):
            img_format = "PNG"

        pdf.add_page()
        pdf.set_font("Helvetica", style="", size=8)
        pdf.set_text_color(120, 120, 120)
        pdf.set_xy(MARGIN, MARGIN)
        pdf.cell(CONTENT_W, 6, header_label, align="L", ln=True)
        pdf.set_text_color(0, 0, 0)

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
        logger.warning("Failed to embed R2 image %s: %s", drive_id, exc)
        pdf.add_page()
        pdf.set_font("Helvetica", style="I", size=10)
        pdf.set_text_color(180, 0, 0)
        pdf.set_xy(MARGIN, MARGIN + 30)
        pdf.cell(CONTENT_W, 8, f"[Image unavailable: {header_label}]", align="C", ln=True)
        pdf.set_text_color(0, 0, 0)


def generate_loa(claim: dict, receipts: list, bank_transactions: list = None, reference_code_override: str = None) -> bytes:
    """
    Generate image pages for a claim in per-BT order:
      For each BT: receipt images linked to that BT, then BT images.
      Unlinked receipts (no BT) appended at the end.

    Parameters
    ----------
    claim : dict
    receipts : list[dict]  — each has images list and bank_transaction_id
    bank_transactions : list[dict]  — each has id and images list
    """
    pdf = FPDF(orientation='P', unit='mm', format='A4')
    pdf.set_auto_page_break(False)

    receipts = receipts or []
    bank_transactions = bank_transactions or []

    # Group receipts by bank_transaction_id
    receipts_by_bt: dict = {}
    unlinked_receipts = []
    for r in receipts:
        bt_id = r.get("bank_transaction_id")
        if bt_id:
            receipts_by_bt.setdefault(bt_id, []).append(r)
        else:
            unlinked_receipts.append(r)

    def _receipt_header(receipt: dict) -> str:
        desc = str(receipt.get("description") or "Receipt")
        amount_raw = receipt.get("amount")
        return f"{desc}  SGD {amount_raw}".strip() if amount_raw is not None else desc

    # For each BT: linked receipt images first, then BT images
    for bt in bank_transactions:
        for receipt in receipts_by_bt.get(bt["id"], []):
            for img in (receipt.get("images") or []):
                if img.get("drive_file_id"):
                    _add_image_page(pdf, img["drive_file_id"], _receipt_header(receipt))
        for img in (bt.get("images") or []):
            if img.get("drive_file_id"):
                _add_image_page(pdf, img["drive_file_id"], "[Bank Transaction]")

    # Unlinked receipts at the end
    for receipt in unlinked_receipts:
        for img in (receipt.get("images") or []):
            if img.get("drive_file_id"):
                _add_image_page(pdf, img["drive_file_id"], _receipt_header(receipt))

    # Ensure at least one page so pypdf can read the file
    if pdf.page == 0:
        pdf.add_page()
        pdf.set_font("Helvetica", style="I", size=10)
        pdf.set_xy(MARGIN, MARGIN + 30)
        pdf.cell(CONTENT_W, 8, "No images attached.", align="C", ln=True)

    return bytes(pdf.output())


# ---------------------------------------------------------------------------
# Google Sheets / Docs service helpers (user OAuth, not service account)
# ---------------------------------------------------------------------------

def _get_user_drive_credentials() -> Credentials:
    """Return refreshed OAuth2 credentials for Drive/Sheets/Docs operations."""
    creds = Credentials(
        token=None,
        refresh_token=settings.DRIVE_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GMAIL_CLIENT_ID,
        client_secret=settings.GMAIL_CLIENT_SECRET,
    )
    creds.refresh(Request())
    return creds


def get_sheets_service():
    """Return an authenticated Google Sheets v4 service using user OAuth."""
    return build('sheets', 'v4', credentials=_get_user_drive_credentials(), cache_discovery=False)


def get_docs_service():
    """Return an authenticated Google Docs v1 service using user OAuth."""
    return build('docs', 'v1', credentials=_get_user_drive_credentials(), cache_discovery=False)


def copy_template(template_id: str, new_name: str) -> str:
    """Copy a Drive template to the user's My Drive root (temporary — trashed after export)."""
    drive = build('drive', 'v3', credentials=_get_user_drive_credentials(), cache_discovery=False)
    result = drive.files().copy(
        fileId=template_id,
        body={"name": new_name},
    ).execute()
    return result["id"]


def export_as_pdf(file_id: str, mime_type: str = 'application/vnd.google-apps.spreadsheet') -> bytes:
    """
    Export a Google Workspace file (Sheets/Docs) as a PDF using user OAuth.

    *mime_type* is unused but kept for API symmetry.
    Returns raw PDF bytes.
    """
    drive_service = build('drive', 'v3', credentials=_get_user_drive_credentials(), cache_discovery=False)
    request = drive_service.files().export_media(
        fileId=file_id,
        mimeType='application/pdf',
    )
    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buffer.getvalue()


def delete_drive_file(file_id: str) -> None:
    """Trash a Drive file (soft delete) using user OAuth."""
    drive_service = build('drive', 'v3', credentials=_get_user_drive_credentials(), cache_discovery=False)
    drive_service.files().update(fileId=file_id, body={"trashed": True}).execute()


# ---------------------------------------------------------------------------
# Summary Sheet generation
# ---------------------------------------------------------------------------

def generate_summary(
    claim: dict,
    line_items: list,
    finance_director: dict,
    reference_code_override: str = None,
) -> bytes:
    """
    Fill the Summary Sheet template with claim data and return PDF bytes.

    Parameters
    ----------
    claim : dict
        Keys: reference_code, date, claim_description, total_amount,
              wbs_no, remarks
    line_items : list[dict]
        Each item has: line_item_index, combined_description, total_amount,
        category_code, gst_code, receipts (list of dicts with receipt_no).
    finance_director : dict
        Keys: name, matric_no, phone
    folder_id : str
        Drive folder ID where the temporary copy is stored.

    Returns
    -------
    bytes
        Raw PDF bytes of the filled summary sheet.
    """
    ref = reference_code_override or claim['reference_code']
    copied_id = copy_template(settings.SUMMARY_TEMPLATE_ID, f"Summary - {ref}")

    try:
        sheets = get_sheets_service()

        # Resolve the first sheet's title so we use the correct tab name.
        spreadsheet_meta = sheets.spreadsheets().get(spreadsheetId=copied_id).execute()
        sheet_title = spreadsheet_meta['sheets'][0]['properties']['title']

        def cell(col_row: str) -> str:
            return f"{sheet_title}!{col_row}"

        # Format date as DD/MM/YYYY
        raw_date = claim.get('date', '')
        try:
            from datetime import datetime as _dt
            # Accept either a date object, datetime object, or ISO string
            if hasattr(raw_date, 'strftime'):
                formatted_date = raw_date.strftime('%d/%m/%Y')
            else:
                formatted_date = _dt.fromisoformat(str(raw_date)).strftime('%d/%m/%Y')
        except Exception:
            formatted_date = str(raw_date)

        total_amount = claim.get('total_amount', 0) or 0

        # --- Fixed cell values ---
        value_ranges = [
            {
                "range": cell("B6"),
                "values": [[ref]],
            },
            {
                "range": cell("B8"),
                "values": [[formatted_date]],
            },
            {
                "range": cell("B12"),
                "values": [[claim.get('claim_description', '')]],
            },
            {
                "range": cell("C20"),
                "values": [[finance_director.get('name', '')]],
            },
            {
                "range": cell("I20"),
                "values": [[finance_director.get('matric_no', '')]],
            },
            {
                "range": cell("C24"),
                "values": [[f"${total_amount:.2f}"]],
            },
            {
                "range": cell("I24"),
                "values": [[finance_director.get('phone', '')]],
            },
            {
                "range": cell("B36"),
                "values": [[claim.get('wbs_no', '')]],
            },
        ]

        # --- Line item rows (starting at row 31) ---
        for idx, item in enumerate(line_items or []):
            row = 31 + idx

            # Collect receipt numbers from the receipts list on this line item
            receipts = item.get('receipts') or []
            receipt_nos = [
                str(r.get('receipt_no', '')).strip()
                for r in receipts
                if r.get('receipt_no') not in (None, '')
            ]
            receipt_nos_str = ', '.join(receipt_nos)

            item_amount = item.get('total_amount', 0) or 0

            # One valueRange per row to keep addressing simple
            value_ranges.append({
                "range": f"{sheet_title}!A{row}:K{row}",
                "values": [[
                    item.get('line_item_index', idx + 1),  # col A
                    receipt_nos_str,                        # col B
                    '',                                     # col C (unused)
                    item.get('combined_description', ''),   # col D
                    '',                                     # col E
                    '',                                     # col F
                    '',                                     # col G
                    '',                                     # col H
                    f"${item_amount:.2f}",                  # col I
                    item.get('category_code', ''),          # col J
                    item.get('gst_code', ''),               # col K
                ]],
            })

        sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=copied_id,
            body={
                "valueInputOption": "USER_ENTERED",
                "data": value_ranges,
            },
        ).execute()

        pdf_bytes = export_as_pdf(copied_id)
        return pdf_bytes

    finally:
        try:
            delete_drive_file(copied_id)
        except Exception as exc:
            logger.warning("Failed to trash temp summary copy %s: %s", copied_id, exc)


# ---------------------------------------------------------------------------
# RFP generation
# ---------------------------------------------------------------------------

def generate_rfp(
    claim: dict,
    line_items: list,
    finance_director: dict,
    reference_code_override: str = None,
) -> bytes:
    """Generate a Request for Payment (RFP) PDF from the Google Doc template."""
    ref = reference_code_override or claim['reference_code']
    copied_id = copy_template(settings.RFP_TEMPLATE_ID, f"RFP - {ref}")
    try:
        # Build placeholder replacements
        replacements = {
            "{{MATRIC}}": (finance_director.get("matric_no") or "").upper(),
            "{{NAME}}": (finance_director.get("name") or "").upper(),
            "{{TOTAL_AMOUNT}}": f"{claim['total_amount']:.2f}",
            "{{REFERENCE_CODE}}": ref,
        }

        for i, item in enumerate(line_items[:5], start=1):
            dollars = int(item["total_amount"])
            cents = round((item["total_amount"] - dollars) * 100)
            replacements.update({
                f"{{{{DR_CR_{i}}}}}": item.get("dr_cr", "DR"),
                f"{{{{GL_{i}}}}}": item.get("category_code", ""),
                f"{{{{DOLLAR_{i}}}}}": str(dollars),
                f"{{{{CENTS_{i}}}}}": f"{cents:02d}",
                f"{{{{GST_{i}}}}}": item.get("gst_code", "IE"),
                f"{{{{WBS_{i}}}}}": claim.get("wbs_no", ""),
            })

        # Clear unused line item slots (indices beyond actual line_items count)
        for i in range(len(line_items) + 1, 6):
            for field in ["DR_CR", "GL", "DOLLAR", "CENTS", "GST", "WBS"]:
                replacements[f"{{{{{field}_{i}}}}}"] = ""

        # Apply all replacements via Docs batchUpdate replaceAllText
        docs_service = get_docs_service()
        requests = [
            {
                "replaceAllText": {
                    "containsText": {"text": placeholder, "matchCase": True},
                    "replaceText": value,
                }
            }
            for placeholder, value in replacements.items()
        ]
        docs_service.documents().batchUpdate(
            documentId=copied_id,
            body={"requests": requests},
        ).execute()

        return export_as_pdf(copied_id, mime_type="application/vnd.google-apps.document")

    finally:
        try:
            delete_drive_file(copied_id)
        except Exception as exc:
            logger.warning("Failed to trash temp RFP copy %s: %s", copied_id, exc)


# ---------------------------------------------------------------------------
# Transport Form generation
# ---------------------------------------------------------------------------

def generate_transport(
    claim: dict,
    transport_data: dict,
    finance_director: dict,
) -> bytes:
    """Generate a transport claim form PDF from the Google Sheets template."""
    copied_id = copy_template(settings.TRANSPORT_TEMPLATE_ID, f"Transport - {claim['reference_code']}")
    try:
        sheets = get_sheets_service()

        # Retrieve the first sheet name
        spreadsheet = sheets.spreadsheets().get(
            spreadsheetId=copied_id,
            fields="sheets.properties.title",
        ).execute()
        sheet_name = spreadsheet["sheets"][0]["properties"]["title"]

        # Build trip rows.
        # Column layout (A–I): From | gap | To | gap | Purpose | gap | Distance | Taxi/Mileage | Bus/MRT
        trips = transport_data.get("trips", [])
        trip_rows = []
        for trip in trips:
            mode = trip.get("mode", "")
            amount = trip.get("amount", "")

            # Taxi and mileage (private car) amounts go in the Taxi column (col H).
            # Bus/MRT amounts go in the Bus/MRT column (col I).
            taxi_col = amount if mode in ("taxi", "mileage") else ""
            bus_mrt_col = amount if mode == "bus_mrt" else ""

            distance = trip.get("distance_km")
            trip_rows.append([
                trip.get("from", ""),   # A
                "",                      # B (gap)
                trip.get("to", ""),      # C
                "",                      # D (gap)
                trip.get("purpose", ""), # E
                "",                      # F (gap)
                distance if distance is not None else "",  # G
                taxi_col,                # H
                bus_mrt_col,             # I
            ])

        if trip_rows:
            sheets.spreadsheets().values().update(
                spreadsheetId=copied_id,
                range=f"{sheet_name}!A2",
                valueInputOption="USER_ENTERED",
                body={"values": trip_rows},
            ).execute()

        # Substitute {{WBS_NO}} placeholder in the financial table (and anywhere
        # else it appears) using Sheets findReplace.
        wbs_no = claim.get("wbs_no", "")
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=copied_id,
            body={
                "requests": [
                    {
                        "findReplace": {
                            "find": "{{WBS_NO}}",
                            "replacement": wbs_no,
                            "allSheets": True,
                        }
                    }
                ]
            },
        ).execute()

        return export_as_pdf(copied_id, mime_type="application/vnd.google-apps.spreadsheet")

    finally:
        try:
            delete_drive_file(copied_id)
        except Exception as exc:
            logger.warning("Failed to trash temp transport copy %s: %s", copied_id, exc)
