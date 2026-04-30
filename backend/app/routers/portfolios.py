from fastapi import APIRouter, Depends
from app.database import get_supabase
from app.auth import require_auth

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


@router.get("/")
async def list_portfolios(auth=Depends(require_auth), db=Depends(get_supabase)):
    result = db.table("portfolios").select("*").order("name").execute()
    return result.data


@router.get("/{portfolio_id}/ccas")
async def list_ccas(portfolio_id: str, auth=Depends(require_auth), db=Depends(get_supabase)):
    result = db.table("ccas").select("*").eq("portfolio_id", portfolio_id).order("name").execute()
    return result.data
