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
    DRIVE_REFRESH_TOKEN: str = ""  # OAuth refresh token with Drive+Sheets+Docs scopes
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = ""
    R2_STORAGE_LIMIT_BYTES: int = 9_500_000_000  # 9.5 GB hard stop
    APP_URL: str = ""  # public HTTPS URL of this backend (e.g. https://api.yourdomain.duckdns.org)
    MINI_APP_URL: str = ""  # Vercel frontend URL (e.g. https://your-app.vercel.app)
    SUMMARY_TEMPLATE_ID: str = "1xPPlWy6T_tZqwFYHZlTSFYqciItF0Jm7Q25k1K-GHX4"
    RFP_TEMPLATE_ID: str = "1wa7B5w65cbN6Omo3SaqiD4csOy5wQz0u3eHn1NEKTMM"
    TRANSPORT_TEMPLATE_ID: str = "15UjYOf0sI1dVzaNJuXKqBnu8nvACPsmXmLYJD08vkY0"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
