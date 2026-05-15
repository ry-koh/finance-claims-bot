import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "service-role")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "123456:test-token")
os.environ.setdefault("GOOGLE_SERVICE_ACCOUNT_JSON", "{}")
os.environ.setdefault("GMAIL_CLIENT_ID", "client")
os.environ.setdefault("GMAIL_CLIENT_SECRET", "secret")
os.environ.setdefault("GMAIL_REFRESH_TOKEN", "refresh")
os.environ.setdefault("GOOGLE_DRIVE_PARENT_FOLDER_ID", "folder")

from app.routers import bot


class FailingDb:
    def table(self, _name):
        raise RuntimeError("database unavailable")


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def execute(self):
        return Result(self.rows)


class Db:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return Query(self.tables.get(name, []))


class RecordingBot:
    def __init__(self):
        self.messages = []

    async def send_message(self, **kwargs):
        self.messages.append(kwargs)


def test_start_replies_even_when_member_lookup_fails():
    recording_bot = RecordingBot()

    asyncio.run(
        bot._handle_start(
            recording_bot,
            FailingDb(),
            chat_id=123,
            telegram_id=456,
            name="Test User",
        )
    )

    assert len(recording_bot.messages) == 1
    message = recording_bot.messages[0]
    assert message["chat_id"] == 123
    assert "Claims App" in message["text"]
    assert "456" in message["text"]
    assert message["reply_markup"] is not None


def test_start_for_unregistered_user_includes_telegram_id():
    recording_bot = RecordingBot()

    asyncio.run(
        bot._handle_start(
            recording_bot,
            Db({"finance_team": []}),
            chat_id=123,
            telegram_id=456,
            name="Test User",
        )
    )

    assert len(recording_bot.messages) == 1
    message = recording_bot.messages[0]
    assert "Claims App" in message["text"]
    assert "456" in message["text"]
