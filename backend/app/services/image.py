"""
Image processing service.

Handles receipt and bank-screenshot images submitted through the Telegram bot
using Pillow.  Responsibilities include:
- Validating uploaded image formats and file sizes.
- Resizing / compressing images to keep PDF file sizes manageable.
- Converting images to a consistent colour space and orientation (EXIF rotation).
- Returning processed image bytes ready for Google Drive upload or PDF embedding.
"""
