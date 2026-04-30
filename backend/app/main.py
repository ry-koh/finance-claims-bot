import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import bot, claimers, claims, documents, receipts

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Finance Claims Bot API starting up")
    yield
    logger.info("Finance Claims Bot API shutting down")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Finance Claims Bot API", lifespan=lifespan)

# CORS — allow all origins by default; restrict via ALLOWED_ORIGINS env var
origins = (
    [o.strip() for o in settings.ALLOWED_ORIGINS.split(",")]
    if settings.ALLOWED_ORIGINS != "*"
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(status_code=500, content={"error": str(exc)})


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(claims.router)
app.include_router(claimers.router)
app.include_router(receipts.router)
app.include_router(documents.router)
app.include_router(bot.router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["health"])
async def health():
    """
    Returns {"status": "ok", "db": "ok"} if Supabase is reachable, or
    {"status": "ok", "db": "error"} if the DB query fails.
    Never returns HTTP 500.
    """
    db_status = "error"
    try:
        from app.database import get_supabase
        db = get_supabase()
        # Lightweight SELECT 1 via PostgREST — works without any specific table
        db.table("finance_team").select("count", count="exact").limit(0).execute()
        db_status = "ok"
    except Exception:
        db_status = "error"

    return {"status": "ok", "db": db_status}
