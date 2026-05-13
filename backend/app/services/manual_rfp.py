import re
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.services.categories import CATEGORY_CODES


class ManualRfpLineItem(BaseModel):
    category: str = ""
    category_code: Optional[str] = None
    amount: float = Field(gt=0)
    gst_code: Literal["IE", "I9", "L9"] = "IE"
    dr_cr: Literal["DR", "CR"] = "DR"

    @field_validator("category", "category_code", mode="before")
    @classmethod
    def _trim_optional_text(cls, value):
        if value is None:
            return value
        return str(value).strip()


class ManualRfpCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    reference_code: Optional[str] = Field(default=None, max_length=60)
    payee_name: str = Field(min_length=1, max_length=120)
    payee_matric_no: str = Field(min_length=1, max_length=40)
    wbs_no: str = Field(min_length=1, max_length=80)
    line_items: list[ManualRfpLineItem] = Field(min_length=1, max_length=5)

    @field_validator("title", "reference_code", "payee_name", "payee_matric_no", "wbs_no", mode="before")
    @classmethod
    def _trim_text(cls, value):
        if value is None:
            return value
        return str(value).strip()

    @model_validator(mode="after")
    def _line_items_need_gl_code(self):
        for item in self.line_items:
            if not item.category_code and not CATEGORY_CODES.get(item.category):
                raise ValueError(f"Missing GL code for {item.category or 'line item'}")
        return self


def normalise_reference_code(reference_code: str | None) -> str:
    raw = (reference_code or "").strip().upper()
    if not raw:
        raw = f"RFP-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    normalised = re.sub(r"[^A-Z0-9_-]+", "-", raw).strip("-")
    normalised = re.sub(r"-{2,}", "-", normalised)
    return normalised or f"RFP-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"


def build_rfp_generation_inputs(payload: ManualRfpCreate) -> tuple[dict, list[dict], dict]:
    reference_code = normalise_reference_code(payload.reference_code)
    line_items = [
        {
            "category_code": item.category_code or CATEGORY_CODES.get(item.category, ""),
            "total_amount": round(float(item.amount), 2),
            "gst_code": item.gst_code,
            "dr_cr": item.dr_cr,
        }
        for item in payload.line_items
    ]
    total_amount = round(sum(item["total_amount"] for item in line_items), 2)
    claim = {
        "reference_code": reference_code,
        "total_amount": total_amount,
        "wbs_no": payload.wbs_no,
    }
    payee = {
        "name": payload.payee_name,
        "matric_no": payload.payee_matric_no.upper(),
    }
    return claim, line_items, payee
