"""
Gmail service.

Sends claim-related emails on behalf of the Finance Director using the Gmail
API with OAuth 2.0 refresh-token credentials.  Responsibilities include:
- Composing and sending the initial claim submission email with PDF attachments.
- Attaching Google Drive links or inline files as required.
- Storing the sent-message ID so screenshots of the email can later be captured.
- Handling token refresh transparently so long-lived deployments keep working.
"""

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from app.config import settings
import base64, logging, re

logger = logging.getLogger(__name__)


def get_gmail_service():
    """Return an authenticated Gmail v1 service using OAuth2 refresh token."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    creds = Credentials(
        token=None,
        refresh_token=settings.GMAIL_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GMAIL_CLIENT_ID,
        client_secret=settings.GMAIL_CLIENT_SECRET,
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def build_claim_email(claim: dict, receipts: list, bank_transactions: list = None) -> MIMEMultipart:
    """
    Build a MIMEMultipart email for a claim submission.

    Parameters
    ----------
    claim : dict
        Full claim dict with nested ``claimer`` (name, matric_no, phone, email)
        and ``claimer.cca.name``.
    receipts : list[dict]
        Flat list of receipt dicts.
    bank_transactions : list[dict]
        Bank transactions with nested ``refunds`` list.

    Returns
    -------
    MIMEMultipart
        A "mixed" MIME message with an HTML body part and image attachments.
        The caller is responsible for setting To/Subject/Cc headers.
    """
    from app.services import pdf as pdf_service

    bank_transactions = bank_transactions or []

    claimer = claim.get("claimer") or {}
    cca = claimer.get("cca") or {}

    # --- Name / identity fields ---
    first_name = (claimer.get("name") or "").split()[0] if claimer.get("name") else ""
    claimer_name_upper = (claimer.get("name") or "").upper()
    claimer_matric_upper = (claimer.get("matric_no") or "").upper()
    claimer_phone = claimer.get("phone") or ""
    cca_name = cca.get("name") or ""

    claim_description = claim.get("claim_description") or ""
    claim_description_upper = claim_description.upper()
    reference_code = claim.get("reference_code") or ""

    total_amount = float(
        claim.get("partial_amount") if claim.get("is_partial") and claim.get("partial_amount") is not None
        else claim.get("total_amount") or 0
    )

    # --- Other emails (for reminder only — not used as actual CC headers) ---
    other_emails = claim.get("other_emails") or []
    cc_reminder_emails = list(other_emails)

    # --- Receipt list HTML ---
    receipt_lines = []
    for n, receipt in enumerate(receipts, start=1):
        amount = float(receipt.get("amount") or 0)
        company = receipt.get("company") or ""
        description = receipt.get("description") or ""
        raw_date = receipt.get("date") or ""
        try:
            from datetime import datetime as _dt
            formatted_date = _dt.fromisoformat(str(raw_date)).strftime('%d/%m/%Y') if raw_date else ""
        except Exception:
            formatted_date = raw_date
        parts = [f"${amount:.2f}"]
        if company:
            parts.append(company)
        parts.append(description)
        if formatted_date:
            parts.append(formatted_date)
        receipt_lines.append(f"<div>#{n}: {', '.join(parts)}</div>")
    receipt_list_html = "\n  ".join(receipt_lines)

    # --- Remarks: user-written portion (strip any stored AUTO block) ---
    raw_remarks = claim.get("remarks") or ""
    # Strip AUTO block including surrounding newlines to avoid blank lines in email
    user_remarks = re.sub(r'\n?<!-- AUTO -->.*?<!-- /AUTO -->\n?', '\n', raw_remarks, flags=re.DOTALL).strip()
    # Collapse any double-newlines left by AUTO block removal or user input
    user_remarks = re.sub(r'\n{2,}', '\n', user_remarks)
    # Also strip MF line if it was previously saved in the user portion (now lives in auto block)
    mf_line = "- Claimed from Master Fund"
    if user_remarks.startswith(mf_line):
        user_remarks = user_remarks[len(mf_line):].strip()

    # --- Auto-remarks computed fresh from current claim state ---
    auto_remarks: list[str] = []
    if claim.get("wbs_account") == "MF":
        auto_remarks.append(mf_line)
    if claim.get("is_partial") and claim.get("partial_amount") is not None:
        auto_remarks.append(f"- Partial Claim of ${float(claim['partial_amount']):.2f}")
    for bt in bank_transactions:
        if bt.get("refunds"):
            refund_amounts = [float(r["amount"]) for r in bt["refunds"]]
            net = float(bt["amount"]) - sum(refund_amounts)
            for amt in refund_amounts:
                auto_remarks.append(f"- An item was refunded and the amount refunded is ${amt:.2f}")
            auto_remarks.append(f"- Initial Bank Transaction is ${float(bt['amount']):.2f}")
            formula = " - ".join([f"${float(bt['amount']):.2f}"] + [f"${a:.2f}" for a in refund_amounts])
            auto_remarks.append(f"- Total Amount is {formula} = ${net:.2f}")
    receipt_count = len(receipts)
    bt_count = len(bank_transactions)
    if receipt_count:
        auto_remarks.append(f"- {receipt_count} Receipt{'s' if receipt_count != 1 else ''} Attached")
    if bt_count:
        auto_remarks.append(f"- {bt_count} Bank Transaction{'s' if bt_count != 1 else ''} Attached")

    # Combine: user remarks then auto remarks, single newline between them
    parts = []
    if user_remarks:
        parts.append(user_remarks)
    if auto_remarks:
        parts.append("\n".join(auto_remarks))
    combined_remarks = "\n".join(parts)

    if combined_remarks:
        remarks_section = f"<p><strong>Remarks:</strong><br>{combined_remarks.replace(chr(10), '<br>')}</p>"
    else:
        remarks_section = ""

    # --- CC line for copy-paste block (always includes FD; plus any other_emails) ---
    cc_all = ["68findirector.rh@gmail.com"] + list(cc_reminder_emails)
    cc_line_html = f"<br><strong>CC:</strong> {', '.join(cc_all)}"

    # --- HTML body ---
    html_body = f"""<div style="font-family: Arial, sans-serif; color: #222; font-size: 14px; line-height: 1.6;">
  <p>Hi {first_name},</p>
  <p>We have received your claim and after sending the following email, this is a confirmation that your claim is being processed. We have also attached the attachments that you have sent for your convenience.</p>
  <p>Please copy and paste everything below the line into a new email. You do not need to reattach the attachments.</p>
  <p>
    <strong>To:</strong> rh.finance@u.nus.edu{cc_line_html}<br>
    <strong>Subject:</strong> {reference_code}
  </p>
  <hr style="border: none; border-top: 2px solid #000; margin: 20px 0;">
  <p>Dear Jun Kiat,</p>
  <p>Attached is the claims for {claim_description}.</p>
  <p>To whom it may concern,</p>
  <p>I, {claimer_name_upper}, {claimer_matric_upper}, hereby authorise my treasurer, Jun Kiat, to collect reimbursement on my behalf.</p>
  <strong>Claims Summary</strong><br>
  <table style="border-collapse: collapse; width: 100%; max-width: 500px;">
    <tr><td style="padding: 6px 10px; border: 1px solid #ccc; background-color: #f5f5f5; font-weight: bold; width: 40%;">CCA</td><td style="padding: 6px 10px; border: 1px solid #ccc;">{cca_name}</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ccc; background-color: #f5f5f5; font-weight: bold;">Event</td><td style="padding: 6px 10px; border: 1px solid #ccc;">{claim_description_upper}</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ccc; background-color: #f5f5f5; font-weight: bold;">CCA Treasurer</td><td style="padding: 6px 10px; border: 1px solid #ccc;">{claimer_name_upper}</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ccc; background-color: #f5f5f5; font-weight: bold;">Phone Number for PayNow</td><td style="padding: 6px 10px; border: 1px solid #ccc;">{claimer_phone}</td></tr>
    <tr><td style="padding: 6px 10px; border: 1px solid #ccc; background-color: #f5f5f5; font-weight: bold;">Total collated amount</td><td style="padding: 6px 10px; border: 1px solid #ccc;">${total_amount:.2f}</td></tr>
  </table>
  <p><strong>Purpose of Purchase:</strong><br>
  {receipt_list_html}
  </p>
  {remarks_section}
  <p>Thank you.</p>
</div>"""

    # --- Assemble MIME message ---
    msg = MIMEMultipart("mixed")
    msg.attach(MIMEText(html_body, "html"))

    # --- Attach receipt images and bank screenshots ---
    for n, receipt in enumerate(receipts, start=1):
        for field, label in [
            ("receipt_image_drive_id", f"receipt_{n}"),
            ("bank_screenshot_drive_id", f"bank_screenshot_{n}"),
        ]:
            drive_id = receipt.get(field)
            if not drive_id:
                continue
            try:
                file_bytes = pdf_service.download_drive_file(drive_id)
                part = MIMEBase("image", "jpeg")
                part.set_payload(file_bytes)
                encoders.encode_base64(part)
                part.add_header(
                    "Content-Disposition",
                    "attachment",
                    filename=f"{label}.jpg",
                )
                msg.attach(part)
            except Exception as exc:
                logger.warning(
                    "Failed to attach drive file %s (%s): %s", drive_id, label, exc
                )

    return msg


def send_email(to: str, subject: str, message: MIMEMultipart) -> str:
    """
    Send a pre-built MIME message via Gmail API.

    Parameters
    ----------
    to : str
        Recipient email address.
    subject : str
        Email subject (used for logging; headers must already be set on
        ``message`` by the caller).
    message : MIMEMultipart
        Fully assembled MIME message (To/Subject/Cc set by caller).

    Returns
    -------
    str
        The Gmail message ID of the sent message.
    """
    gmail = get_gmail_service()
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    result = gmail.users().messages().send(
        userId="me",
        body={"raw": raw},
    ).execute()
    message_id = result.get("id", "")
    logger.info("Email sent to %s (subject=%s) gmail_id=%s", to, subject, message_id)
    return message_id
