"""
Cloudflare R2 storage service (S3-compatible).

Handles uploading, deleting, and generating presigned URLs for receipt and
bank-screenshot images. Uses boto3 against R2's S3-compatible endpoint.

Object names follow the pattern: {reference_code}/receipts/{file_type}_{timestamp}.jpg
"""

import datetime
import io
import logging

import boto3
from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.config import settings

logger = logging.getLogger(__name__)

_QUOTA_ERROR_CODES = {"QuotaExceeded", "StorageQuotaExceeded", "TotalStorageExceeded"}


def _get_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def upload_file(file_bytes: bytes, object_name: str, content_type: str = "image/jpeg") -> str:
    """
    Upload file_bytes to the R2 bucket under object_name.
    Returns object_name (stored as the image identifier in DB).
    Raises HTTP 507 if the R2 bucket quota is exceeded.
    """
    client = _get_client()
    try:
        client.put_object(
            Bucket=settings.R2_BUCKET_NAME,
            Key=object_name,
            Body=io.BytesIO(file_bytes),
            ContentType=content_type,
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in _QUOTA_ERROR_CODES:
            logger.warning("R2 storage quota exceeded on upload of %s", object_name)
            raise HTTPException(
                status_code=507,
                detail="Storage limit reached (10 GB). Contact your administrator.",
            )
        logger.exception("R2 upload failed for %s: %s", object_name, exc)
        raise HTTPException(status_code=502, detail=f"R2 upload failed: {str(exc)[:300]}")
    return object_name


def delete_file(object_name: str) -> None:
    """Delete an object from R2. Silently ignores not-found errors."""
    try:
        client = _get_client()
        client.delete_object(Bucket=settings.R2_BUCKET_NAME, Key=object_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code == "NoSuchKey":
            return
        logger.warning("R2 delete failed for %s: %s", object_name, exc)


def generate_signed_url(object_name: str, expiration_minutes: int = 60) -> str:
    """
    Generate a presigned GET URL for object_name, valid for expiration_minutes.
    """
    client = _get_client()
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.R2_BUCKET_NAME, "Key": object_name},
            ExpiresIn=expiration_minutes * 60,
        )
    except ClientError as exc:
        logger.exception("Failed to generate presigned URL for %s: %s", object_name, exc)
        raise HTTPException(status_code=502, detail="Could not generate image URL")


def download_file(object_name: str) -> bytes:
    """Download an object from the R2 bucket and return its bytes."""
    client = _get_client()
    try:
        response = client.get_object(Bucket=settings.R2_BUCKET_NAME, Key=object_name)
        return response["Body"].read()
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code == "NoSuchKey":
            raise ValueError(f"R2 object not found: {object_name}")
        logger.exception("R2 download failed for %s: %s", object_name, exc)
        raise


def make_object_name(reference_code: str, file_type: str, timestamp: str) -> str:
    """Build the R2 object name: {reference_code}/receipts/{file_type}_{timestamp}.jpg"""
    return f"{reference_code}/receipts/{file_type}_{timestamp}.jpg"


def make_document_object_name(reference_code: str, filename: str) -> str:
    """Build the R2 object name for a generated document: {reference_code}/documents/{filename}"""
    return f"{reference_code}/documents/{filename}"
