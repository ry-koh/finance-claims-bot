#!/usr/bin/env python3
"""
One-time script to generate a DRIVE_REFRESH_TOKEN for Google Drive/Sheets/Docs access.

Run this locally (not on Cloud Run):
    python backend/scripts/get_drive_token.py

Then update the printed DRIVE_REFRESH_TOKEN in GitHub Actions secrets and redeploy Cloud Run.
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
creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")

print("\n" + "=" * 60)
print("Update this GitHub Actions secret, then redeploy Cloud Run:")
print(f"DRIVE_REFRESH_TOKEN={creds.refresh_token}")
print("=" * 60)
