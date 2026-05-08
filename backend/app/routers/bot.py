from fastapi import APIRouter, Request, Depends, HTTPException
from telegram import Bot, Update, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from telegram.request import HTTPXRequest
from app.config import settings
from app.database import get_supabase
from app.auth import require_director
from app.utils.rate_limit import guard, RateLimiter
import logging

_limiter_bot = RateLimiter()

router = APIRouter(prefix="/bot", tags=["bot"])
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_bot():
    return Bot(token=settings.TELEGRAM_BOT_TOKEN)


def _mini_app_url() -> str:
    return settings.MINI_APP_URL or "https://example.com"


async def _send_message(bot, chat_id: int, text: str, **kwargs) -> None:
    """Send a text message, logging errors without raising."""
    try:
        await bot.send_message(chat_id=chat_id, text=text, **kwargs)
    except Exception as exc:
        logger.error("Failed to send Telegram message to %s: %s", chat_id, exc)


async def send_bot_notification(telegram_id, text: str) -> None:
    """Fire-and-forget: send a Telegram message to a user. Silently ignores all errors."""
    try:
        bot = Bot(
            token=settings.TELEGRAM_BOT_TOKEN,
            request=HTTPXRequest(connect_timeout=10, read_timeout=30),
        )
        try:
            await bot.send_message(chat_id=int(telegram_id), text=text)
        finally:
            try:
                await bot.close()
            except Exception:
                pass
    except Exception as exc:
        logger.warning("Bot notification failed for %s: %s", telegram_id, exc)


async def _get_member(db, telegram_id: int) -> dict | None:
    """Return the finance_team row for telegram_id, or None."""
    resp = (
        db.table("finance_team")
        .select("*")
        .eq("telegram_id", telegram_id)
        .execute()
    )
    return resp.data[0] if resp.data else None


# ---------------------------------------------------------------------------
# Command handlers
# ---------------------------------------------------------------------------

async def _handle_start(bot, db, chat_id: int, telegram_id: int, name: str) -> None:
    member = await _get_member(db, telegram_id)
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Open Claims App", web_app=WebAppInfo(url=_mini_app_url()))]]
    )
    if not member:
        await _send_message(
            bot,
            chat_id,
            "Welcome! Tap below to open the Claims App and complete your registration.\n\n💡 Tip: Pin this message so you can easily open the app anytime.",
            reply_markup=keyboard,
        )
        return
    await _send_message(
        bot,
        chat_id,
        f"Welcome, {member['name']}! Use the button below to open the Claims App.\n\n💡 Tip: Pin this message so you can easily open the app anytime.",
        reply_markup=keyboard,
    )


async def _handle_register_director(
    bot, db, chat_id: int, sender_id: int, args: list[str]
) -> None:
    """/register_director <name> <email> — bootstrap the first Finance Director.
    Only works when the finance_team table is completely empty."""
    existing = db.table("finance_team").select("id", count="exact").limit(1).execute()
    if existing.count and existing.count > 0:
        await _send_message(
            bot,
            chat_id,
            "A Finance Director is already registered. "
            "Ask them to use /confirm_member to add new members.",
        )
        return

    if len(args) < 2:
        await _send_message(
            bot,
            chat_id,
            "Usage: /register_director <name> <email>\n"
            "Example: /register_director Jane Doe jane@example.com",
            parse_mode="HTML",
        )
        return

    email = args[-1]
    name = " ".join(args[:-1])

    try:
        db.table("finance_team").insert(
            {"telegram_id": sender_id, "name": name, "email": email, "role": "director"}
        ).execute()
    except Exception as exc:
        logger.error("Failed to register director: %s", exc)
        await _send_message(bot, chat_id, f"Failed to register: {exc}")
        return

    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("Open Claims App", web_app=WebAppInfo(url=_mini_app_url()))]]
    )
    await _send_message(
        bot,
        chat_id,
        f"You are now registered as Finance Director, {name}!\n"
        "Use the button below to open the Claims App.\n\n"
        "To add team members:\n"
        "1. Have them send /start to this bot.\n"
        "2. Run /confirm_member with their Telegram ID.",
        reply_markup=keyboard,
    )


async def _handle_addmember(bot, db, chat_id: int, sender_id: int) -> None:
    """Director-only: Prints instructions for registering a new member."""
    member = await _get_member(db, sender_id)
    if not member or member.get("role") != "director":
        await _send_message(bot, chat_id, "Access denied: director role required.")
        return

    await _send_message(
        bot,
        chat_id,
        "To add a new member:\n\n"
        "1. Have the new member send /start to this bot.\n"
        "   They will receive their Telegram ID in the reply.\n\n"
        "2. Once you have their ID, run:\n"
        "<code>/confirm_member &lt;telegram_id&gt; &lt;name&gt; &lt;email&gt; &lt;role&gt;</code>\n\n"
        "Example:\n"
        "<code>/confirm_member 123456789 Jane Doe jane@example.com member</code>\n\n"
        "Valid roles: <b>member</b>, <b>director</b>",
        parse_mode="HTML",
    )


async def _handle_confirm_member(
    bot, db, chat_id: int, sender_id: int, args: list[str]
) -> None:
    """Director-only: /confirm_member <telegram_id> <name...> <email> <role>"""
    member = await _get_member(db, sender_id)
    if not member or member.get("role") != "director":
        await _send_message(bot, chat_id, "Access denied: director role required.")
        return

    # Minimum args: telegram_id, at least one name part, email, role  => 4 tokens
    if len(args) < 4:
        await _send_message(
            bot,
            chat_id,
            "Usage: /confirm_member &lt;telegram_id&gt; &lt;name&gt; &lt;email&gt; &lt;role&gt;\n"
            "Example: /confirm_member 123456789 Jane Doe jane@example.com member",
            parse_mode="HTML",
        )
        return

    new_telegram_id_str = args[0]
    role = args[-1]
    email = args[-2]
    name = " ".join(args[1:-2])  # everything between telegram_id and email

    if role not in ("director", "member"):
        await _send_message(bot, chat_id, "Role must be 'director' or 'member'.")
        return

    try:
        new_telegram_id = int(new_telegram_id_str)
    except ValueError:
        await _send_message(bot, chat_id, f"Invalid Telegram ID: {new_telegram_id_str!r}")
        return

    if not name:
        await _send_message(bot, chat_id, "Name cannot be empty.")
        return

    # Check for duplicate
    existing = await _get_member(db, new_telegram_id)
    if existing:
        await _send_message(
            bot,
            chat_id,
            f"Member with Telegram ID {new_telegram_id} is already registered as {existing['name']}.",
        )
        return

    try:
        db.table("finance_team").insert(
            {
                "telegram_id": new_telegram_id,
                "name": name,
                "email": email,
                "role": role,
            }
        ).execute()
    except Exception as exc:
        logger.error("DB insert failed for telegram_id=%s: %s", new_telegram_id, exc)
        await _send_message(bot, chat_id, f"Failed to add member: {exc}")
        return

    await _send_message(
        bot,
        chat_id,
        f"Member added successfully.\n"
        f"Name: {name}\nEmail: {email}\nRole: {role}\nTelegram ID: {new_telegram_id}",
    )


async def _handle_listmembers(bot, db, chat_id: int, sender_id: int) -> None:
    """Director-only: list all finance_team members."""
    member = await _get_member(db, sender_id)
    if not member or member.get("role") != "director":
        await _send_message(bot, chat_id, "Access denied: director role required.")
        return

    try:
        resp = db.table("finance_team").select("*").order("name").execute()
    except Exception as exc:
        logger.error("DB select failed: %s", exc)
        await _send_message(bot, chat_id, f"Failed to fetch members: {exc}")
        return

    if not resp.data:
        await _send_message(bot, chat_id, "No members found in the finance team.")
        return

    lines = ["<b>Finance Team Members:</b>\n"]
    for m in resp.data:
        lines.append(
            f"• <b>{m['name']}</b> ({m['role']})\n"
            f"  Email: {m['email']}\n"
            f"  Telegram ID: <code>{m['telegram_id']}</code>"
        )
    await _send_message(bot, chat_id, "\n".join(lines), parse_mode="HTML")


async def _handle_removemember(
    bot, db, chat_id: int, sender_id: int, args: list[str]
) -> None:
    """Director-only: /removemember <telegram_id>"""
    member = await _get_member(db, sender_id)
    if not member or member.get("role") != "director":
        await _send_message(bot, chat_id, "Access denied: director role required.")
        return

    if not args:
        await _send_message(
            bot,
            chat_id,
            "Usage: /removemember &lt;telegram_id&gt;",
            parse_mode="HTML",
        )
        return

    try:
        target_id = int(args[0])
    except ValueError:
        await _send_message(bot, chat_id, f"Invalid Telegram ID: {args[0]!r}")
        return

    target = await _get_member(db, target_id)
    if not target:
        await _send_message(bot, chat_id, f"No member found with Telegram ID {target_id}.")
        return

    try:
        db.table("finance_team").delete().eq("telegram_id", target_id).execute()
    except Exception as exc:
        logger.error("DB delete failed for telegram_id=%s: %s", target_id, exc)
        await _send_message(bot, chat_id, f"Failed to remove member: {exc}")
        return

    await _send_message(
        bot,
        chat_id,
        f"Member {target['name']} (ID: {target_id}) has been removed.",
    )


# ---------------------------------------------------------------------------
# Webhook endpoint
# ---------------------------------------------------------------------------

@router.post("/webhook")
async def webhook(request: Request):
    """Receive Telegram updates via webhook."""
    try:
        data = await request.json()
    except Exception as exc:
        logger.warning("Webhook received malformed JSON: %s", exc)
        return {"ok": True}  # Return 200 to prevent Telegram retries

    try:
        update = Update.de_json(data, bot=None)
    except Exception as exc:
        logger.warning("Could not parse Telegram update: %s", exc)
        return {"ok": True}

    # Only handle messages with text commands
    message = getattr(update, "message", None)
    if not message or not message.text:
        return {"ok": True}

    chat_id: int = message.chat.id
    sender_id: int = message.from_user.id if message.from_user else None
    sender_name: str = (
        message.from_user.full_name if message.from_user else "Unknown"
    )
    text: str = message.text.strip()

    if sender_id is None:
        return {"ok": True}

    # Rate limit: 5 commands per 30 seconds per user
    if not _limiter_bot.is_allowed(f"bot:{sender_id}", 5, 30):
        return {"ok": True}  # silently drop; avoid spam feedback loop

    # Extract command and args; strip bot username suffix (e.g. /start@MyBot)
    parts = text.split()
    raw_cmd = parts[0].lower()
    command = raw_cmd.split("@")[0]  # strip @botusername if present
    args = parts[1:]

    bot = _get_bot()
    db = get_supabase()

    try:
        if command == "/start":
            await _handle_start(bot, db, chat_id, sender_id, sender_name)

        elif command == "/register_director":
            await _handle_register_director(bot, db, chat_id, sender_id, args)

        elif command == "/addmember":
            await _handle_addmember(bot, db, chat_id, sender_id)

        elif command == "/confirm_member":
            await _handle_confirm_member(bot, db, chat_id, sender_id, args)

        elif command == "/listmembers":
            await _handle_listmembers(bot, db, chat_id, sender_id)

        elif command == "/removemember":
            await _handle_removemember(bot, db, chat_id, sender_id, args)

        else:
            await _send_message(
                bot,
                chat_id,
                "Unknown command. Available commands:\n"
                "/start — Open the Claims App\n"
                "/register_director — First-time setup: register yourself as Finance Director\n"
                "/addmember — Instructions to add a new member (director only)\n"
                "/confirm_member — Register a new member (director only)\n"
                "/listmembers — List all team members (director only)\n"
                "/removemember — Remove a team member (director only)",
            )
    except Exception as exc:
        logger.exception("Error handling command %s from %s: %s", command, sender_id, exc)

    finally:
        try:
            await bot.close()
        except Exception as exc:
            logger.warning("Error closing bot session: %s", exc)

    return {"ok": True}


# ---------------------------------------------------------------------------
# Set-webhook endpoint (director auth via HTTP header)
# ---------------------------------------------------------------------------

@router.post("/set_webhook")
async def set_webhook(director: dict = Depends(require_director)):
    """Manually trigger webhook registration with Telegram. Requires director auth."""
    if not settings.APP_URL:
        raise HTTPException(
            status_code=400,
            detail="APP_URL is not configured; cannot set webhook.",
        )

    webhook_url = f"{settings.APP_URL}/bot/webhook"
    bot = _get_bot()
    try:
        result = await bot.set_webhook(
            url=webhook_url,
            allowed_updates=["message"],
        )
    except Exception as exc:
        logger.error("Failed to set webhook: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to set webhook: {exc}")
    finally:
        await bot.close()

    if result:
        return {"ok": True, "webhook_url": webhook_url}
    raise HTTPException(status_code=500, detail="Telegram rejected webhook registration.")
