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
