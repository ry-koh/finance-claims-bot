"""
Run this script once to get the Gmail OAuth refresh token.
Usage: python scripts/gmail_auth.py
Copy the refresh token printed at the end into your .env as GMAIL_REFRESH_TOKEN
"""
from google_auth_oauthlib.flow import InstalledAppFlow
import json, os

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]

def main():
    client_config = {
        "installed": {
            "client_id": input("Enter Gmail OAuth Client ID: ").strip(),
            "client_secret": input("Enter Gmail OAuth Client Secret: ").strip(),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"]
        }
    }
    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=0)
    print("\n=== COPY THIS TO YOUR .env FILE ===")
    print(f"GMAIL_REFRESH_TOKEN={creds.refresh_token}")
    print("===================================\n")

if __name__ == "__main__":
    main()
