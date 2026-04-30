from fastapi import APIRouter

router = APIRouter(prefix="/receipts", tags=["receipts"])


@router.get("/")
async def list_receipts():
    return {"message": "not yet implemented"}
