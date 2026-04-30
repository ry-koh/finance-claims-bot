from fastapi import APIRouter

router = APIRouter(prefix="/claims", tags=["claims"])


@router.get("/")
async def list_claims():
    return {"message": "not yet implemented"}
