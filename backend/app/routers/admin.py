from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from app.auth import require_director
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
    """
    Approve a pending registration.
    For treasurers: auto-creates one Claimer record per linked CCA.
    """
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("id", member_id)
        .eq("status", "pending")
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Pending registration not found")
    member = resp.data[0]

    db.table("finance_team").update({"status": "active"}).eq("id", member_id).execute()

    if member.get("role") == "treasurer":
        cca_resp = (
            db.table("treasurer_ccas")
            .select("cca_id")
            .eq("finance_team_id", member_id)
            .execute()
        )
        try:
            for row in (cca_resp.data or []):
                db.table("claimers").insert({
                    "cca_id": row["cca_id"],
                    "name": member["name"],
                    "email": member["email"],
                }).execute()
        except Exception:
            db.table("finance_team").update({"status": "pending"}).eq("id", member_id).execute()
            raise HTTPException(500, "Failed to create claimer records; registration reverted to pending")

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


class UpdateMemberRequest(BaseModel):
    role: str
    cca_ids: list[str] = []


@router.patch("/team/{member_id}")
async def update_team_member(
    member_id: str,
    payload: UpdateMemberRequest,
    director: dict = Depends(require_director),
    db: Client = Depends(get_supabase),
):
    """Update role (and CCAs for treasurers) for an active member."""
    if payload.role not in ("member", "treasurer"):
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

    db.table("finance_team").update({"role": payload.role}).eq("id", member_id).execute()

    # Replace treasurer_ccas entirely
    db.table("treasurer_ccas").delete().eq("finance_team_id", member_id).execute()

    if payload.role == "treasurer":
        db.table("treasurer_ccas").insert([
            {"finance_team_id": member_id, "cca_id": cca_id}
            for cca_id in payload.cca_ids
        ]).execute()

        # Create claimer records for any new CCAs not previously covered
        existing_claimers = (
            db.table("claimers")
            .select("cca_id")
            .eq("name", member["name"])
            .execute()
        )
        existing_cca_ids = {row["cca_id"] for row in (existing_claimers.data or [])}
        new_cca_ids = [cid for cid in payload.cca_ids if cid not in existing_cca_ids]
        if new_cca_ids:
            db.table("claimers").insert([
                {"cca_id": cca_id, "name": member["name"], "email": member.get("email", "")}
                for cca_id in new_cca_ids
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
