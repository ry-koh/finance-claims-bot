from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_KEY: str  # service role key
    TELEGRAM_BOT_TOKEN: str
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: int = 86400
    TELEGRAM_WEBHOOK_SECRET_TOKEN: str = ""
    REGISTER_TELEGRAM_WEBHOOK_ON_STARTUP: bool = False
    ALLOWED_ORIGINS: str = ""
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
    DOCGEN_MAX_WORKERS: int = 1
    MAX_UPLOAD_BYTES: int = 8_000_000
    MAX_PDF_PAGES: int = 20
    MAX_RECEIPT_IMAGES_PER_RECEIPT: int = 8
    MAX_BANK_IMAGES_PER_TRANSACTION: int = 8
    MAX_REFUND_FILES_PER_REFUND: int = 5
    MAX_ATTACHMENT_FILES_PER_REQUEST: int = 10
    APP_URL: str = ""  # public HTTPS URL of this backend (e.g. https://api.yourdomain.duckdns.org)
    MINI_APP_URL: str = ""  # Vercel frontend URL (e.g. https://your-app.vercel.app)
    SUMMARY_TEMPLATE_ID: str = "1xPPlWy6T_tZqwFYHZlTSFYqciItF0Jm7Q25k1K-GHX4"
    RFP_TEMPLATE_ID: str = "1wa7B5w65cbN6Omo3SaqiD4csOy5wQz0u3eHn1NEKTMM"
    TRANSPORT_TEMPLATE_ID: str = "15UjYOf0sI1dVzaNJuXKqBnu8nvACPsmXmLYJD08vkY0"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @property
    def telegram_webhook_secret(self) -> str:
        """Stable secret used by Telegram to authenticate webhook delivery."""
        if self.TELEGRAM_WEBHOOK_SECRET_TOKEN:
            return self.TELEGRAM_WEBHOOK_SECRET_TOKEN
        import hashlib

        return hashlib.sha256(self.TELEGRAM_BOT_TOKEN.encode("utf-8")).hexdigest()


settings = Settings()
