from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from app.auth import require_auth
from app.database import get_supabase
from app.models import ClaimerCreate, ClaimerUpdate

router = APIRouter(prefix="/claimers", tags=["claimers"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SELECT = "*, cca:ccas(*, portfolio:portfolios(*))"


def _fetch_claimer_by_id(db: Client, claimer_id: str) -> dict:
    response = (
        db.table("claimers")
        .select(_SELECT)
        .eq("id", claimer_id)
        .single()
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="Claimer not found")
    return response.data


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_claimers(
    cca_id: Optional[str] = None,
    search: Optional[str] = None,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    query = db.table("claimers").select(_SELECT)
    if cca_id:
        query = query.eq("cca_id", cca_id)
    if search:
        query = query.or_(
            f"name.ilike.%{search}%,matric_no.ilike.%{search}%,email.ilike.%{search}%"
        )
    result = query.order("name").execute()
    return result.data or []


@router.get("/{claimer_id}")
async def get_claimer(
    claimer_id: str,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    return _fetch_claimer_by_id(db, claimer_id)


@router.post("", status_code=201)
async def create_claimer(
    body: ClaimerCreate,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    # Validate cca_id exists (404 if not)
    cca_check = (
        db.table("ccas")
        .select("id")
        .eq("id", str(body.cca_id))
        .execute()
    )
    if not cca_check.data:
        raise HTTPException(status_code=404, detail="CCA not found")

    payload = {
        "cca_id": str(body.cca_id),
        "name": body.name,
    }
    if body.matric_no is not None:
        payload["matric_no"] = body.matric_no
    if body.phone is not None:
        payload["phone"] = body.phone
    if body.email is not None:
        payload["email"] = body.email

    insert_response = db.table("claimers").insert(payload).execute()
    if not insert_response.data:
        raise HTTPException(status_code=500, detail="Failed to create claimer")

    created_id = insert_response.data[0]["id"]
    return _fetch_claimer_by_id(db, created_id)


@router.patch("/{claimer_id}")
async def update_claimer(
    claimer_id: str,
    body: ClaimerUpdate,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    # Confirm claimer exists
    _fetch_claimer_by_id(db, claimer_id)

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields provided for update")

    # Validate new cca_id if supplied
    if "cca_id" in updates:
        cca_check = (
            db.table("ccas")
            .select("id")
            .eq("id", str(updates["cca_id"]))
            .execute()
        )
        if not cca_check.data:
            raise HTTPException(status_code=404, detail="CCA not found")
        updates["cca_id"] = str(updates["cca_id"])

    db.table("claimers").update(updates).eq("id", claimer_id).execute()

    return _fetch_claimer_by_id(db, claimer_id)


@router.delete("/{claimer_id}")
async def delete_claimer(
    claimer_id: str,
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    # Confirm claimer exists
    _fetch_claimer_by_id(db, claimer_id)

    # Block deletion if active claims reference this claimer
    claims_check = (
        db.table("claims")
        .select("id", count="exact")
        .eq("claimer_id", claimer_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if claims_check.count and claims_check.count > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete claimer with active claims",
        )

    db.table("claimers").delete().eq("id", claimer_id).execute()
    return {"deleted": True}
