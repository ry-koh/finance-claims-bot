# Finance Claims Bot — Setup Guide

## One-Time Setup (Finance Director only)

### 1. Supabase
1. Go to supabase.com and create a free project
2. Go to SQL Editor and run all files in `supabase/migrations/` in order (001, 002, 003, 004)
3. Copy your Project URL and service role key from Settings → API

### 2. Google Cloud
1. Go to console.cloud.google.com and create a new project
2. Enable these APIs: Google Drive API, Google Docs API, Google Sheets API, Gmail API
3. Create a Service Account (for Drive/Docs/Sheets):
   - IAM & Admin → Service Accounts → Create
   - Download the JSON key file
   - Share your Google Drive claims folder with the service account email
4. Create OAuth2 credentials (for Gmail):
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Add `http://localhost` as redirect URI
   - Note your Client ID and Client Secret
   - Run the one-time auth script: `python backend/scripts/gmail_auth.py`
   - Copy the refresh token from the output

### 3. Telegram Bot
1. Message @BotFather on Telegram
2. Send `/newbot` and follow prompts to get your bot token
3. Send `/newapp` to create a Mini App, set URL to your Vercel deployment URL
4. Regenerate your token after initial setup (for security)

### 4. Deploy
1. Push this repo to GitHub
2. **Render (backend):**
   - Go to render.com → New Web Service → Connect your GitHub repo
   - Set root directory to `backend/`
   - Add all env vars from `backend/.env.example`
   - Copy your Render URL (e.g. `https://finance-claims-bot.onrender.com`)
3. **Vercel (frontend):**
   - Go to vercel.com → New Project → Connect your GitHub repo
   - Set root directory to `frontend/`
   - Add env var: `VITE_API_URL=https://your-render-app.onrender.com`
4. **GitHub Actions:**
   - Go to your GitHub repo → Settings → Secrets → Actions
   - Add secret: `RENDER_URL` = your Render URL

### 5. Register yourself as Finance Director
Send `/start` to your bot, then:
```
/register_director YOUR_NAME YOUR_EMAIL
```

## If the bot stops responding
1. Go to render.com
2. Find your `finance-claims-bot` service
3. Click "Manual Deploy" → "Deploy latest commit"
4. Wait ~2 minutes

## Adding team members
Send this to your bot:
```
/addmember @their_telegram_username
```
They need to send `/start` to the bot first.
