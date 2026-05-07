import logging
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from app.services import r2

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/images", tags=["images"])


@router.get("/view")
def view_image(path: str = Query(..., description="R2 object name")):
    """
    Download an R2 object and serve the bytes directly.
    Proxying (instead of redirecting) ensures the image is same-origin,
    which allows crop tools to draw it on a canvas without CORS errors.
    """
    try:
        image_bytes = r2.download_file(path)
    except Exception as exc:
        logger.exception("Failed to fetch image %s: %s", path, exc)
        raise HTTPException(status_code=502, detail="Could not fetch image")
    return Response(
        content=image_bytes,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )
