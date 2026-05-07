import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import bot, claimers, claims, documents, email as email_router, images as images_router, portfolios, receipts
from app.routers import bank_transactions as bank_transactions_router
from app.routers import registration as registration_router
from app.routers import admin as admin_router
from app.routers import messages as messages_router
from app.routers import analytics as analytics_router

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

async def _register_webhook() -> None:
    """Call Telegram setWebhook on startup if APP_URL is configured."""
    if not settings.APP_URL:
        logger.info("APP_URL not set; skipping webhook registration.")
        return

    webhook_url = f"{settings.APP_URL}/bot/webhook"
    api_url = (
        f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/setWebhook"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                api_url,
                json={"url": webhook_url, "allowed_updates": ["message"], "drop_pending_updates": True},
            )
            data = resp.json()
            if data.get("ok"):
                logger.info("Telegram webhook registered: %s", webhook_url)
            else:
                logger.warning(
                    "Telegram webhook registration returned not-ok: %s", data
                )
    except Exception as exc:
        logger.error("Failed to register Telegram webhook on startup: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Finance Claims Bot API starting up")
    await _register_webhook()
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
app.include_router(portfolios.router)
app.include_router(bot.router)
app.include_router(email_router.router)
app.include_router(bank_transactions_router.router)
app.include_router(images_router.router)
app.include_router(registration_router.router)
app.include_router(admin_router.router)
app.include_router(messages_router.router)
app.include_router(analytics_router.router)


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
