from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import require_director
from app.database import get_supabase

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary")
async def get_summary(
    group_by: str = Query(..., pattern="^(cca|portfolio|fund)$"),
    status: List[str] = Query(default=[]),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    _director: dict = Depends(require_director),
    db=Depends(get_supabase),
):
    params = {
        "p_group_by": group_by,
        "p_statuses": status if status else None,
        "p_date_from": date_from or None,
        "p_date_to": date_to or None,
    }

    try:
        result = db.rpc("analytics_summary", params).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analytics query failed: {exc}")

    rows = [
        {
            "name": r["name"],
            "portfolio": r.get("portfolio"),
            "total": float(r["total"]),
        }
        for r in (result.data or [])
    ]
    grand_total = sum(r["total"] for r in rows)

    return {"rows": rows, "grand_total": grand_total}
