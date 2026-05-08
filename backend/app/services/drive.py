"""
Google Drive service.

Handles uploading, downloading, and organising files in Google Drive using a
service-account credential.  Each claim gets its own folder under the
configured GOOGLE_DRIVE_PARENT_FOLDER_ID.  Responsibilities include:
- Creating per-claim sub-folders.
- Uploading receipt images, bank screenshots, and compiled PDF documents.
- Returning shareable Drive file IDs stored on the Claim / Receipt rows.
- Deleting or moving files when a claim is cancelled or superseded.
"""

from app.config import settings
import json
import io
import logging

logger = logging.getLogger(__name__)

SCOPES = ['https://www.googleapis.com/auth/drive']


def get_drive_service():
    """
    Build and return an authenticated Google Drive v3 service using the
    service account credentials stored in settings.
    """
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build('drive', 'v3', credentials=creds, cache_discovery=False)


def upload_file(file_bytes: bytes, filename: str, mime_type: str, parent_folder_id: str) -> str:
    """
    Upload file_bytes to Google Drive under parent_folder_id.
    Returns the Drive file ID string.
    Supports both My Drive and Shared Drives (supportsAllDrives=True).
    """
    from googleapiclient.http import MediaIoBaseUpload
    drive = get_drive_service()
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=False)
    result = drive.files().create(
        body={"name": filename, "parents": [parent_folder_id]},
        media_body=media,
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return result["id"]


def get_or_create_folder(name: str, parent_folder_id: str) -> str:
    """
    Return the Drive folder ID for a folder named `name` directly under
    `parent_folder_id`.  Creates the folder if it does not already exist.
    Supports both My Drive and Shared Drives.
    """
    drive = get_drive_service()

    # Escape single quotes in the folder name to avoid query injection
    safe_name = name.replace("'", "\\'")
    query = (
        f"name='{safe_name}' "
        f"and '{parent_folder_id}' in parents "
        f"and mimeType='application/vnd.google-apps.folder' "
        f"and trashed=false"
    )
    result = drive.files().list(
        q=query,
        fields="files(id)",
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    files = result.get("files", [])

    if files:
        return files[0]["id"]

    # Create the folder
    folder = drive.files().create(
        body={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_folder_id],
        },
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return folder["id"]


def get_claim_folder_id(reference_code: str) -> str:
    """
    Return (creating if necessary) the Drive folder ID for the given claim
    reference code under the top-level parent folder.
    """
    return get_or_create_folder(reference_code, settings.GOOGLE_DRIVE_PARENT_FOLDER_ID)


def download_file(file_id: str) -> bytes:
    """Download a file from Google Drive by file ID. Returns raw bytes."""
    from googleapiclient.http import MediaIoBaseDownload
    drive = get_drive_service()
    request = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return fh.getvalue()


def get_file_size(file_id: str) -> int:
    """Return a Drive file's size from metadata without downloading it."""
    drive = get_drive_service()
    result = drive.files().get(
        fileId=file_id,
        fields="size",
        supportsAllDrives=True,
    ).execute()
    size = result.get("size")
    if size is None:
        raise ValueError(f"Drive file has no size metadata: {file_id}")
    return int(size)


def set_public_readable(file_id: str) -> None:
    """Make a Drive file readable by anyone with the link."""
    try:
        drive = get_drive_service()
        drive.permissions().create(
            fileId=file_id,
            body={"type": "anyone", "role": "reader"},
            supportsAllDrives=True,
        ).execute()
    except Exception as e:
        logger.warning("Could not set public permission on file %s: %s", file_id, e)


def delete_file(file_id: str) -> None:
    """
    Move a Drive file to the trash (soft delete).
    Supports both My Drive and Shared Drives.
    """
    drive = get_drive_service()
    drive.files().update(fileId=file_id, body={"trashed": True}, supportsAllDrives=True).execute()
