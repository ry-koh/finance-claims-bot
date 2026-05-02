#!/usr/bin/env python3
"""
One-time script to generate a DRIVE_REFRESH_TOKEN for Google Drive/Sheets/Docs access.

Run this locally (not on Render):
    python backend/scripts/get_drive_token.py

Then add the printed DRIVE_REFRESH_TOKEN to your Render environment variables.
"""

import sys

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Install google-auth-oauthlib first: pip install google-auth-oauthlib")
    sys.exit(1)

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
]

print("Enter your OAuth2 client credentials (same ones used for GMAIL_CLIENT_ID/SECRET).")
client_id = input("GMAIL_CLIENT_ID: ").strip()
client_secret = input("GMAIL_CLIENT_SECRET: ").strip()

client_config = {
    "installed": {
        "client_id": client_id,
        "client_secret": client_secret,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": ["http://localhost"],
    }
}

flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
creds = flow.run_local_server(port=0)

print("\n" + "=" * 60)
print("Add this environment variable to Render:")
print(f"DRIVE_REFRESH_TOKEN={creds.refresh_token}")
print("=" * 60)
