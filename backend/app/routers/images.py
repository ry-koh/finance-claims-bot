import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.services import r2

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/images", tags=["images"])


@router.get("/view")
async def view_image(path: str = Query(..., description="R2 object name")):
    """
    Generate a short-lived signed URL for a R2 object and redirect to it.
    Used by the frontend to display receipt and bank-screenshot images.
    """
    try:
        url = r2.generate_signed_url(path)
    except Exception as exc:
        logger.exception("Failed to generate signed URL for %s: %s", path, exc)
        raise HTTPException(status_code=502, detail="Could not generate image URL")
    return RedirectResponse(url=url, status_code=302)
