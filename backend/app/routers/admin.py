from fastapi import APIRouter, Depends, HTTPException
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
