from fastapi import APIRouter

router = APIRouter(prefix="/bot", tags=["bot"])


@router.get("/")
async def bot_status():
    return {"message": "not yet implemented"}
