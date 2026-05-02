"""
Google Cloud Storage service.

Handles uploading, downloading, and deleting receipt/bank-screenshot images
in a GCS bucket using the same service-account credential as the Drive service.
Object names follow the pattern: {reference_code}/receipts/{filename}
"""

import datetime
import io
import json
import logging

from google.cloud import storage
from google.oauth2 import service_account

from app.config import settings

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


def _get_credentials():
    info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
    return service_account.Credentials.from_service_account_info(info, scopes=_SCOPES), info.get("project_id")


def _get_client() -> storage.Client:
    creds, project = _get_credentials()
    return storage.Client(credentials=creds, project=project)


def upload_file(file_bytes: bytes, object_name: str, content_type: str = "image/jpeg") -> str:
    """
    Upload file_bytes to the configured GCS bucket under object_name.
    Returns the object_name (used as the stored identifier).
    """
    client = _get_client()
    bucket = client.bucket(settings.GCS_BUCKET_NAME)
    blob = bucket.blob(object_name)
    blob.upload_from_file(io.BytesIO(file_bytes), content_type=content_type)
    return object_name


def delete_file(object_name: str) -> None:
    """Delete an object from the GCS bucket. Silently ignores not-found errors."""
    try:
        client = _get_client()
        bucket = client.bucket(settings.GCS_BUCKET_NAME)
        blob = bucket.blob(object_name)
        blob.delete()
    except Exception as exc:
        logger.warning("GCS delete failed for %s: %s", object_name, exc)


def generate_signed_url(object_name: str, expiration_minutes: int = 60) -> str:
    """
    Generate a V4 signed URL for reading object_name.
    URL is valid for expiration_minutes (default 60).
    """
    creds, project = _get_credentials()
    client = storage.Client(credentials=creds, project=project)
    bucket = client.bucket(settings.GCS_BUCKET_NAME)
    blob = bucket.blob(object_name)
    return blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(minutes=expiration_minutes),
        method="GET",
        credentials=creds,
    )


def make_object_name(reference_code: str, file_type: str, timestamp: str) -> str:
    """Build the GCS object name: {reference_code}/receipts/{file_type}_{timestamp}.jpg"""
    return f"{reference_code}/receipts/{file_type}_{timestamp}.jpg"
