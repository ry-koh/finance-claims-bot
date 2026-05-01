from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_KEY: str  # service role key
    TELEGRAM_BOT_TOKEN: str
    ALLOWED_ORIGINS: str = "*"
    GOOGLE_SERVICE_ACCOUNT_JSON: str  # JSON string of service account credentials
    GMAIL_CLIENT_ID: str
    GMAIL_CLIENT_SECRET: str
    GMAIL_REFRESH_TOKEN: str
    GOOGLE_DRIVE_PARENT_FOLDER_ID: str
    ACADEMIC_YEAR: str = "2526"
    RENDER_EXTERNAL_URL: str = ""  # set by Render automatically
    SUMMARY_TEMPLATE_ID: str = "1xPPlWy6T_tZqwFYHZlTSFYqciItF0Jm7Q25k1K-GHX4"
    RFP_TEMPLATE_ID: str = "1wa7B5w65cbN6Omo3SaqiD4csOy5wQz0u3eHn1NEKTMM"
    TRANSPORT_TEMPLATE_ID: str = "1OCs7FB_NUd2--IX3ST5oQ-nRUQK5TcnhiL6gqvKJZ4k"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
