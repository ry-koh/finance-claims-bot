import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from supabase import Client

from app.database import get_supabase
from app.services import r2
from app.services.image_access import assert_can_view_path, member_from_init_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/images", tags=["images"])


@router.get("/view")
def view_image(
    path: str = Query(..., description="R2 object name"),
    init_data: str | None = Query(default=None),
    db: Client = Depends(get_supabase),
):
    """
    Download an R2 object after verifying Telegram auth and object ownership.

    The frontend passes signed Telegram init data in the image URL because
    browser image tags cannot attach custom auth headers.
    """
    member = member_from_init_data(init_data, db)
    assert_can_view_path(db, path, member)

    try:
        image_bytes = r2.download_file(path)
    except Exception as exc:
        logger.exception("Failed to fetch image %s: %s", path, exc)
        raise HTTPException(status_code=502, detail="Could not fetch image")
    return Response(
        content=image_bytes,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=300"},
    )
