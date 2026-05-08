from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.database import get_supabase
from app.auth import require_auth, require_director

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PortfolioCreate(BaseModel):
    name: str

class PortfolioUpdate(BaseModel):
    name: str

class CcaCreate(BaseModel):
    name: str

class CcaUpdate(BaseModel):
    name: str | None = None
    portfolio_id: str | None = None


# ---------------------------------------------------------------------------
# Read endpoints (any authenticated user)
# ---------------------------------------------------------------------------

@router.get("/ccas/public")
async def list_all_ccas_public(db=Depends(get_supabase)):
    """Public endpoint for CCA listing during registration — no auth required."""
    result = (
        db.table("ccas")
        .select("*, portfolio:portfolios(id, name)")
        .order("name")
        .execute()
    )
    return result.data


@router.get("")
async def list_portfolios(auth=Depends(require_auth), db=Depends(get_supabase)):
    result = db.table("portfolios").select("*").order("name").execute()
    return result.data


@router.get("/{portfolio_id}/ccas")
async def list_ccas(portfolio_id: str, auth=Depends(require_auth), db=Depends(get_supabase)):
    result = (
        db.table("ccas")
        .select("*")
        .eq("portfolio_id", portfolio_id)
        .order("name")
        .execute()
    )
    return result.data


# ---------------------------------------------------------------------------
# Portfolio write endpoints (director only)
# ---------------------------------------------------------------------------

@router.post("")
async def create_portfolio(body: PortfolioCreate, auth=Depends(require_director), db=Depends(get_supabase)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    try:
        result = db.table("portfolios").insert({"name": name}).execute()
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="A portfolio with that name already exists")
        raise
    return result.data[0]


@router.patch("/{portfolio_id}")
async def update_portfolio(
    portfolio_id: str,
    body: PortfolioUpdate,
    auth=Depends(require_director),
    db=Depends(get_supabase),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    try:
        result = (
            db.table("portfolios")
            .update({"name": name})
            .eq("id", portfolio_id)
            .execute()
        )
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="A portfolio with that name already exists")
        raise
    if not result.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return result.data[0]


@router.delete("/{portfolio_id}", status_code=204)
async def delete_portfolio(
    portfolio_id: str,
    auth=Depends(require_director),
    db=Depends(get_supabase),
):
    try:
        db.table("portfolios").delete().eq("id", portfolio_id).execute()
    except Exception as exc:
        err = str(exc).lower()
        if "foreign key" in err or "restrict" in err:
            raise HTTPException(
                status_code=409,
                detail="Cannot delete: one or more CCAs in this portfolio have existing claims",
            )
        raise


# ---------------------------------------------------------------------------
# CCA write endpoints (director only)
# ---------------------------------------------------------------------------

@router.post("/{portfolio_id}/ccas")
async def create_cca(
    portfolio_id: str,
    body: CcaCreate,
    auth=Depends(require_director),
    db=Depends(get_supabase),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    try:
        result = (
            db.table("ccas")
            .insert({"portfolio_id": portfolio_id, "name": name})
            .execute()
        )
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="A CCA with that name already exists in this portfolio")
        raise
    return result.data[0]


@router.patch("/ccas/{cca_id}")
async def update_cca(
    cca_id: str,
    body: CcaUpdate,
    auth=Depends(require_director),
    db=Depends(get_supabase),
):
    updates = {}
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name cannot be empty")
        updates["name"] = name
    if body.portfolio_id is not None:
        updates["portfolio_id"] = body.portfolio_id
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    try:
        result = db.table("ccas").update(updates).eq("id", cca_id).execute()
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="A CCA with that name already exists in this portfolio")
        raise
    if not result.data:
        raise HTTPException(status_code=404, detail="CCA not found")
    return result.data[0]


@router.delete("/ccas/{cca_id}", status_code=204)
async def delete_cca(
    cca_id: str,
    auth=Depends(require_director),
    db=Depends(get_supabase),
):
    try:
        db.table("ccas").delete().eq("id", cca_id).execute()
    except Exception as exc:
        err = str(exc).lower()
        if "foreign key" in err or "restrict" in err:
            raise HTTPException(
                status_code=409,
                detail="Cannot delete: this CCA has existing claims",
            )
        raise
