from fastapi import APIRouter

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/")
async def list_documents():
    return {"message": "not yet implemented"}
