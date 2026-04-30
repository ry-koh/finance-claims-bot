"""
Gmail service.

Sends claim-related emails on behalf of the Finance Director using the Gmail
API with OAuth 2.0 refresh-token credentials.  Responsibilities include:
- Composing and sending the initial claim submission email with PDF attachments.
- Attaching Google Drive links or inline files as required.
- Storing the sent-message ID so screenshots of the email can later be captured.
- Handling token refresh transparently so long-lived deployments keep working.
"""
