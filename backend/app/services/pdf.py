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
import io, os, tempfile, logging, json, time
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2 import service_account
from app.services.drive import get_drive_service
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
    Generate a Letter of Authorisation (LOA) PDF for the given claim.

    Page order:
      Cover page → for each receipt: its receipt images, then (when the last
      receipt linked to a bank transaction is reached) that BT's images once →
      any BTs not linked to any receipt at the end.

    Parameters
    ----------
    claim : dict
        Keys: reference_code, date, claim_description,
              claimer (nested dict with name, matric_no)
    receipts : list[dict]
        Each dict has: description, amount,
                       images (list of {drive_file_id}),
                       bank_transaction_id (str | None)
    bank_transactions : list[dict]
        Each dict has: id, images (list of {drive_file_id})
    """
    pdf = FPDF(orientation='P', unit='mm', format='A4')
    pdf.set_auto_page_break(False)

    receipts = receipts or []
    bank_transactions = bank_transactions or []
    bt_map = {bt["id"]: bt for bt in bank_transactions}

    # For each BT, record the index of its last linked receipt
    bt_last_pos: dict = {}
    for i, r in enumerate(receipts):
        bt_id = r.get("bank_transaction_id")
        if bt_id:
            bt_last_pos[bt_id] = i

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

    pdf.set_font("Helvetica", style="B", size=16)
    pdf.set_xy(MARGIN, 40)
    pdf.cell(CONTENT_W, 10, "LETTER OF AUTHORISATION", align="C", ln=True)

    _ref_code = reference_code_override or claim.get("reference_code", "")
    pdf.set_font("Helvetica", style="B", size=14)
    pdf.set_xy(MARGIN, 60)
    pdf.cell(CONTENT_W, 8, str(_ref_code), align="C", ln=True)

    pdf.set_font("Helvetica", style="", size=11)
    pdf.set_xy(MARGIN, 75)
    pdf.cell(CONTENT_W, 7, str(claim.get("claim_description", "")), align="C", ln=True)

    pdf.set_font("Helvetica", style="", size=11)
    pdf.set_xy(MARGIN, 90)
    pdf.cell(CONTENT_W, 7, claimer_line, align="C", ln=True)

    pdf.set_font("Helvetica", style="", size=10)
    pdf.set_xy(MARGIN, 105)
    pdf.cell(CONTENT_W, 6, str(claim.get("date", "")), align="C", ln=True)

    receipt_image_count = sum(len(r.get("images") or []) for r in receipts)
    bt_image_count = sum(len(bt.get("images") or []) for bt in bank_transactions)
    total_image_count = receipt_image_count + bt_image_count

    if total_image_count > 0:
        pdf.set_font("Helvetica", style="I", size=10)
        pdf.set_xy(MARGIN, 125)
        pdf.cell(CONTENT_W, 6, "The following receipt images are attached below:", align="C", ln=True)
        pdf.set_font("Helvetica", style="", size=10)
        pdf.set_xy(MARGIN, 135)
        pdf.cell(CONTENT_W, 6, f"Total receipts: {len(receipts)}", align="C", ln=True)
    else:
        pdf.set_font("Helvetica", style="I", size=10)
        pdf.set_xy(MARGIN, 125)
        pdf.cell(CONTENT_W, 6, "No receipt images attached.", align="C", ln=True)

    # ------------------------------------------------------------------
    # Receipt image pages, with BT images inserted after their last receipt
    # ------------------------------------------------------------------
    for i, receipt in enumerate(receipts):
        desc = str(receipt.get("description") or "Receipt")
        amount_raw = receipt.get("amount")
        amount_str = f"SGD {amount_raw}" if amount_raw is not None else ""
        receipt_header = f"{desc}  {amount_str}".strip()

        for img in (receipt.get("images") or []):
            drive_id = img.get("drive_file_id")
            if drive_id:
                _add_image_page(pdf, drive_id, receipt_header)

        # After the last receipt linked to a BT, emit that BT's images once
        bt_id = receipt.get("bank_transaction_id")
        if bt_id and bt_last_pos.get(bt_id) == i:
            bt = bt_map.get(bt_id)
            if bt:
                bt_receipt_descs = [
                    r.get("description", "") for r in receipts
                    if r.get("bank_transaction_id") == bt_id
                ]
                bt_header = f"[Bank Transaction]  {', '.join(bt_receipt_descs)}".strip()
                for img in (bt.get("images") or []):
                    drive_id = img.get("drive_file_id")
                    if drive_id:
                        _add_image_page(pdf, drive_id, bt_header)

    # ------------------------------------------------------------------
    # Bank transactions not linked to any receipt (orphaned)
    # ------------------------------------------------------------------
    for bt in bank_transactions:
        if bt["id"] not in bt_last_pos:
            for img in (bt.get("images") or []):
                drive_id = img.get("drive_file_id")
                if drive_id:
                    _add_image_page(pdf, drive_id, "[Bank Transaction]")

    return bytes(pdf.output())


# ---------------------------------------------------------------------------
# Google Sheets / Docs service helpers
# ---------------------------------------------------------------------------

def get_sheets_service():
    """Return an authenticated Google Sheets v4 service."""
    info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=[
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    )
    return build('sheets', 'v4', credentials=creds, cache_discovery=False)


def get_docs_service():
    """Return an authenticated Google Docs v1 service."""
    info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=[
            'https://www.googleapis.com/auth/documents',
            'https://www.googleapis.com/auth/drive',
        ],
    )
    return build('docs', 'v1', credentials=creds, cache_discovery=False)


def copy_template(template_id: str, new_name: str, parent_folder_id: str) -> str:
    """
    Copy a Drive file (template) to *parent_folder_id* with *new_name*.

    Returns the new file's Drive ID.
    """
    drive = get_drive_service()
    result = drive.files().copy(
        fileId=template_id,
        body={"name": new_name, "parents": [parent_folder_id]},
    ).execute()
    return result["id"]


def export_as_pdf(file_id: str, mime_type: str = 'application/vnd.google-apps.spreadsheet') -> bytes:
    """
    Export a Google Workspace file (Sheets/Docs) as a PDF.

    *mime_type* is unused at the call site but kept for API symmetry — the
    Drive export endpoint always receives 'application/pdf'.

    Returns raw PDF bytes.
    """
    drive_service = get_drive_service()
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
    """Trash a Drive file (soft delete)."""
    drive_service = get_drive_service()
    drive_service.files().update(fileId=file_id, body={"trashed": True}).execute()


# ---------------------------------------------------------------------------
# Summary Sheet generation
# ---------------------------------------------------------------------------

def generate_summary(
    claim: dict,
    line_items: list,
    finance_director: dict,
    folder_id: str,
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
    copied_id = copy_template(
        settings.SUMMARY_TEMPLATE_ID,
        f"Summary - {ref}",
        folder_id,
    )

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
    folder_id: str,
    reference_code_override: str = None,
) -> bytes:
    """
    Generate a Request for Payment (RFP) PDF from the Google Doc template.

    Parameters
    ----------
    claim : dict
        Keys: reference_code, wbs_no, total_amount
    line_items : list[dict]
        Up to 5 items.  Each has: dr_cr, category_code, total_amount, gst_code.
    finance_director : dict
        Keys: name, matric_no
    folder_id : str
        Drive folder ID where the temporary copy will be created.

    Returns
    -------
    bytes
        PDF bytes of the completed RFP.
    """
    ref = reference_code_override or claim['reference_code']
    copied_id = copy_template(
        settings.RFP_TEMPLATE_ID,
        f"RFP - {ref}",
        folder_id,
    )
    try:
        # Build placeholder replacements
        replacements = {
            "{{MATRIC}}": finance_director["matric_no"].upper(),
            "{{NAME}}": finance_director["name"].upper(),
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
    folder_id: str,
) -> bytes:
    """
    Generate a transport claim form PDF from the Google Sheets template.

    Parameters
    ----------
    claim : dict
        Keys: reference_code, wbs_no
    transport_data : dict
        Keys:
          trips        - list of dicts with keys: from, to, purpose,
                         distance_km (float | None), mode ("taxi" | "bus_mrt" |
                         "mileage"), amount (float)
          total_amount - float (used by the financial rows pre-filled in the
                         template; finance team verifies)
    finance_director : dict
        Keys: name
    folder_id : str
        Drive folder ID where the temporary copy will be created.

    Returns
    -------
    bytes
        PDF bytes of the completed transport form.

    Notes
    -----
    Trip rows are written into the trip table starting at row 2 (A2).
    The financial table rows are pre-filled in the template; only the WBS
    number is substituted using a Sheets findReplace request so that
    any {{WBS_NO}} placeholder present in the template is replaced.
    """
    copied_id = copy_template(
        settings.TRANSPORT_TEMPLATE_ID,
        f"Transport - {claim['reference_code']}",
        folder_id,
    )
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
