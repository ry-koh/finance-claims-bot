from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from supabase import Client
from typing import Optional

from app.auth import require_auth, require_director
from app.database import get_supabase

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/pending-registrations")
async def list_pending(
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """List all pending registration requests (director only)."""
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("status", "pending")
        .order("created_at", desc=False)
        .execute()
    )
    members = resp.data or []

    for member in members:
        if member.get("role") == "treasurer":
            cca_resp = (
                db.table("treasurer_ccas")
                .select("cca_id, ccas(id, name)")
                .eq("finance_team_id", member["id"])
                .execute()
            )
            member["ccas"] = [row["ccas"] for row in (cca_resp.data or []) if row.get("ccas")]

    return members


@router.get("/pending-registrations/count")
async def pending_count(
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Return count of pending registrations for the badge."""
    resp = (
        db.table("finance_team")
        .select("id", count="exact")
        .eq("status", "pending")
        .execute()
    )
    return {"count": resp.count or 0}


@router.post("/approve/{member_id}")
async def approve_registration(
    member_id: str,
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Approve a pending registration."""
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("id", member_id)
        .eq("status", "pending")
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Pending registration not found")

    db.table("finance_team").update({"status": "active"}).eq("id", member_id).execute()
    return {"success": True}


@router.delete("/reject/{member_id}")
async def reject_registration(
    member_id: str,
    _director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Reject and delete a pending registration."""
    resp = db.table("finance_team").delete().eq("id", member_id).eq("status", "pending").execute()
    if not resp.data:
        raise HTTPException(404, "Pending registration not found")
    return {"success": True}


# ---------------------------------------------------------------------------
# Team management (active members)
# ---------------------------------------------------------------------------

def _attach_ccas(db, members: list[dict]) -> None:
    """Mutate each treasurer in-place by attaching their CCA list."""
    for member in members:
        if member.get("role") == "treasurer":
            cca_resp = (
                db.table("treasurer_ccas")
                .select("cca_id, ccas(id, name)")
                .eq("finance_team_id", member["id"])
                .execute()
            )
            member["ccas"] = [row["ccas"] for row in (cca_resp.data or []) if row.get("ccas")]
        else:
            member.setdefault("ccas", [])


@router.get("/team")
async def list_team_members(
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """List all active non-director members."""
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("status", "active")
        .neq("role", "director")
        .order("name")
        .execute()
    )
    members = resp.data or []
    _attach_ccas(db, members)
    return members


@router.get("/treasurer-options")
async def list_treasurer_options(
    cca_id: str = Query(...),
    _member: dict = Depends(require_auth),
    db: Client = Depends(get_supabase),
):
    """Return active finance_team treasurers linked to a given CCA, for the new claim form."""
    links_resp = (
        db.table("treasurer_ccas")
        .select("finance_team_id")
        .eq("cca_id", cca_id)
        .execute()
    )
    ft_ids = [row["finance_team_id"] for row in (links_resp.data or [])]
    if not ft_ids:
        return []
    members_resp = (
        db.table("finance_team")
        .select("id, name, email")
        .in_("id", ft_ids)
        .eq("status", "active")
        .order("name")
        .execute()
    )
    return members_resp.data or []


class UpdateMemberRequest(BaseModel):
    role: Optional[str] = None
    cca_ids: list[str] = []
    name: Optional[str] = None
    email: Optional[str] = None
    matric_number: Optional[str] = None
    phone_number: Optional[str] = None


@router.patch("/team/{member_id}")
async def update_team_member(
    member_id: str,
    payload: UpdateMemberRequest,
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Update role, name, email, matric_number, phone_number (and CCAs for treasurers) for an active member."""
    if payload.role is not None and payload.role not in ("member", "treasurer"):
        raise HTTPException(400, "role must be 'member' or 'treasurer'")
    if payload.role == "treasurer" and not payload.cca_ids:
        raise HTTPException(400, "Treasurers must have at least one CCA")

    resp = (
        db.table("finance_team")
        .select("*")
        .eq("id", member_id)
        .eq("status", "active")
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Active member not found")
    member = resp.data[0]
    if member.get("role") == "director":
        raise HTTPException(403, "Cannot modify a director")

    update_fields: dict = {}
    if payload.role is not None:
        update_fields["role"] = payload.role
    if payload.name is not None:
        update_fields["name"] = payload.name.strip()
    if payload.email is not None:
        update_fields["email"] = payload.email.strip()
    if payload.matric_number is not None:
        update_fields["matric_number"] = payload.matric_number.strip()
    if payload.phone_number is not None:
        update_fields["phone_number"] = payload.phone_number.strip()

    if update_fields:
        db.table("finance_team").update(update_fields).eq("id", member_id).execute()

    # Replace treasurer_ccas entirely if CCA list provided (or role is changing)
    effective_role = update_fields.get("role", member.get("role"))
    if payload.cca_ids or (payload.role is not None):
        db.table("treasurer_ccas").delete().eq("finance_team_id", member_id).execute()
        if effective_role == "treasurer":
            db.table("treasurer_ccas").insert([
                {"finance_team_id": member_id, "cca_id": cca_id}
                for cca_id in payload.cca_ids
            ]).execute()

    updated = db.table("finance_team").select("*").eq("id", member_id).single().execute()
    result = updated.data
    _attach_ccas(db, [result])
    return result


@router.delete("/team/{member_id}")
async def remove_team_member(
    member_id: str,
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Remove an active member. Cannot remove yourself."""
    if str(director["id"]) == str(member_id):
        raise HTTPException(400, "Cannot remove yourself")

    resp = (
        db.table("finance_team")
        .select("role")
        .eq("id", member_id)
        .eq("status", "active")
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Active member not found")
    if resp.data[0].get("role") == "director":
        raise HTTPException(403, "Cannot remove a director")

    db.table("finance_team").delete().eq("id", member_id).execute()
    return {"success": True}
