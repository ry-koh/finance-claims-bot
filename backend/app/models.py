from datetime import date as _date, datetime
from decimal import Decimal
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class WBSAccount(str, Enum):
    SA = "SA"
    MBH = "MBH"
    MF = "MF"
    OTHERS = "OTHERS"


class ClaimStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    EMAIL_SENT = "email_sent"
    SCREENSHOT_PENDING = "screenshot_pending"
    SCREENSHOT_UPLOADED = "screenshot_uploaded"
    DOCS_GENERATED = "docs_generated"
    COMPILED = "compiled"
    SUBMITTED = "submitted"
    ATTACHMENT_REQUESTED = "attachment_requested"
    ATTACHMENT_UPLOADED = "attachment_uploaded"
    REIMBURSED = "reimbursed"
    ERROR = "error"


class DocumentType(str, Enum):
    LOA = "loa"
    SUMMARY = "summary"
    RFP = "rfp"
    TRANSPORT = "transport"
    EMAIL_SCREENSHOT = "email_screenshot"
    COMPILED = "compiled"


class UserRole(str, Enum):
    DIRECTOR = "director"
    MEMBER = "member"
    TREASURER = "treasurer"


class GSTCode(str, Enum):
    IE = "IE"
    I9 = "I9"
    L9 = "L9"


class DRCRType(str, Enum):
    DR = "DR"
    CR = "CR"


# ---------------------------------------------------------------------------
# Core models
# ---------------------------------------------------------------------------

class Portfolio(BaseModel):
    id: UUID
    name: str


class PortfolioCreate(BaseModel):
    name: str


class PortfolioUpdate(BaseModel):
    name: Optional[str] = None


# ---------------------------------------------------------------------------

class CCA(BaseModel):
    id: UUID
    portfolio_id: UUID
    name: str


class CCACreate(BaseModel):
    portfolio_id: UUID
    name: str


class CCAUpdate(BaseModel):
    portfolio_id: Optional[UUID] = None
    name: Optional[str] = None


# ---------------------------------------------------------------------------

class FinanceTeamMember(BaseModel):
    id: UUID
    telegram_id: int
    name: str
    email: Optional[str] = None
    role: UserRole


class FinanceTeamMemberCreate(BaseModel):
    telegram_id: int
    name: str
    email: Optional[str] = None
    role: UserRole = UserRole.MEMBER


class FinanceTeamMemberUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[UserRole] = None


# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------

class ClaimLineItem(BaseModel):
    id: UUID
    claim_id: UUID
    line_item_index: int
    category: str
    category_code: Optional[str] = None
    gst_code: GSTCode
    dr_cr: DRCRType
    combined_description: Optional[str] = None
    total_amount: Decimal


class ClaimLineItemCreate(BaseModel):
    claim_id: UUID
    line_item_index: int
    category: str
    category_code: Optional[str] = None
    gst_code: GSTCode
    dr_cr: DRCRType
    combined_description: Optional[str] = None
    total_amount: Decimal


class ClaimLineItemUpdate(BaseModel):
    line_item_index: Optional[int] = None
    category: Optional[str] = None
    category_code: Optional[str] = None
    gst_code: Optional[GSTCode] = None
    dr_cr: Optional[DRCRType] = None
    combined_description: Optional[str] = None
    total_amount: Optional[Decimal] = None


# ---------------------------------------------------------------------------

class Receipt(BaseModel):
    id: UUID
    claim_id: UUID
    line_item_id: Optional[UUID] = None
    receipt_no: Optional[str] = None
    description: str
    company: Optional[str] = None
    date: Optional[_date] = None
    amount: Decimal
    receipt_image_drive_id: Optional[str] = None
    bank_screenshot_drive_id: Optional[str] = None


class ReceiptCreate(BaseModel):
    claim_id: str
    payer_id: Optional[str] = None
    payer_name: str
    payer_email: str
    receipt_no: Optional[str] = None
    description: str
    company: Optional[str] = None
    date: Optional[str] = None  # ISO format YYYY-MM-DD
    amount: float
    category: str
    gst_code: str = "IE"  # IE, I9, or L9
    dr_cr: str = "DR"
    receipt_image_drive_id: Optional[str] = None
    bank_screenshot_drive_id: Optional[str] = None
    receipt_image_drive_ids: List[str] = []
    bank_transaction_id: Optional[str] = None
    bank_transaction_drive_ids: Optional[List[str]] = None  # creates new BT if set
    is_foreign_currency: bool = False
    exchange_rate_screenshot_drive_id: Optional[str] = None
    exchange_rate_screenshot_drive_ids: Optional[List[str]] = None
    claimed_amount: Optional[float] = None


class ReceiptUpdate(BaseModel):
    payer_id: Optional[str] = None
    payer_name: Optional[str] = None
    payer_email: Optional[str] = None
    receipt_no: Optional[str] = None
    description: Optional[str] = None
    company: Optional[str] = None
    date: Optional[str] = None  # ISO format YYYY-MM-DD
    amount: Optional[float] = None
    claimed_amount: Optional[float] = None
    category: Optional[str] = None
    gst_code: Optional[str] = None
    dr_cr: Optional[str] = None
    receipt_image_drive_id: Optional[str] = None
    bank_screenshot_drive_id: Optional[str] = None
    receipt_image_drive_ids: Optional[List[str]] = None  # replaces all images if set
    bank_transaction_id: Optional[str] = None
    bank_transaction_drive_ids: Optional[List[str]] = None  # creates new BT if set
    clear_bank_transaction: Optional[bool] = None  # set True to explicitly unlink
    is_foreign_currency: Optional[bool] = None
    exchange_rate_screenshot_drive_id: Optional[str] = None
    exchange_rate_screenshot_drive_ids: Optional[List[str]] = None


class SplitCheckResponse(BaseModel):
    split_needed: bool
    reason: Optional[str] = None  # 'max_categories' or None
    receipt: Optional[dict] = None
    line_item: Optional[dict] = None


# ---------------------------------------------------------------------------

class Claim(BaseModel):
    id: UUID
    reference_code: Optional[str] = None
    claim_number: Optional[int] = None
    claimer_id: Optional[UUID] = None
    cca_id: Optional[UUID] = None
    one_off_name: Optional[str] = None
    one_off_matric_no: Optional[str] = None
    one_off_phone: Optional[str] = None
    one_off_email: Optional[str] = None
    filled_by: Optional[UUID] = None
    processed_by: Optional[UUID] = None
    claim_description: str
    total_amount: Decimal
    date: _date
    wbs_account: WBSAccount
    wbs_no: Optional[str] = None
    remarks: Optional[str] = None
    status: ClaimStatus
    error_message: Optional[str] = None
    transport_form_needed: bool
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ClaimCreate(BaseModel):
    cca_id: UUID
    claimer_id: Optional[UUID] = None
    one_off_name: Optional[str] = None
    one_off_matric_no: Optional[str] = None
    one_off_phone: Optional[str] = None
    one_off_email: Optional[str] = None
    filled_by: Optional[UUID] = None
    claim_description: str
    total_amount: Decimal
    date: _date
    wbs_account: WBSAccount
    wbs_no: Optional[str] = None
    remarks: Optional[str] = None
    transport_form_needed: bool = False
    is_partial: bool = False


class ClaimUpdate(BaseModel):
    claimer_id: Optional[UUID] = None
    cca_id: Optional[UUID] = None
    one_off_name: Optional[str] = None
    one_off_matric_no: Optional[str] = None
    one_off_phone: Optional[str] = None
    one_off_email: Optional[str] = None
    filled_by: Optional[UUID] = None
    processed_by: Optional[UUID] = None
    claim_description: Optional[str] = None
    total_amount: Optional[Decimal] = None
    date: Optional[_date] = None
    wbs_account: Optional[WBSAccount] = None
    wbs_no: Optional[str] = None
    remarks: Optional[str] = None
    status: Optional[ClaimStatus] = None
    error_message: Optional[str] = None
    transport_form_needed: Optional[bool] = None
    is_partial: Optional[bool] = None
    mf_approval_drive_id: Optional[str] = None
    client_updated_at: Optional[str] = None
    internal_notes: Optional[str] = None


# ---------------------------------------------------------------------------

class ClaimDocument(BaseModel):
    id: UUID
    claim_id: UUID
    type: DocumentType
    drive_file_id: str
    is_current: bool
    created_at: datetime


class ClaimDocumentCreate(BaseModel):
    claim_id: UUID
    type: DocumentType
    drive_file_id: str
    is_current: bool = True


class ClaimDocumentUpdate(BaseModel):
    drive_file_id: Optional[str] = None
    is_current: Optional[bool] = None


# ---------------------------------------------------------------------------
# Receipt images & bank transactions
# ---------------------------------------------------------------------------

class ReceiptImageCreate(BaseModel):
    receipt_id: str
    drive_file_id: str


class BankTransactionCreate(BaseModel):
    claim_id: str
    drive_file_ids: List[str] = []  # images to attach immediately


class BankTransactionImageCreate(BaseModel):
    bank_transaction_id: str
    drive_file_id: str
