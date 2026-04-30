from fastapi import APIRouter

router = APIRouter(prefix="/claimers", tags=["claimers"])


@router.get("/")
async def list_claimers():
    return {"message": "not yet implemented"}
