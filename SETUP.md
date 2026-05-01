# Finance Claims Bot — Setup Guide

This guide walks through the complete one-time setup. Do it in order — each step depends on the previous one.

---

## Step 1 — Supabase (Database)

### Create the project
1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **New project**
3. Give it a name (e.g. `finance-claims`), set a database password, choose a region close to Singapore
4. Wait ~2 minutes for it to provision

### Run the database migrations
1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file `supabase/migrations/001_schema.sql` from this repo in any text editor (Notepad, VS Code, etc.)
4. Select all the text (`Ctrl+A`), copy it
5. Paste it into the Supabase SQL Editor and click **Run**
6. You should see "Success. No rows returned"
7. Repeat for each file in order:
   - `002_indexes.sql`
   - `003_functions.sql`
   - `004_seed.sql`
   - `005_transport_data.sql`

### Copy your credentials
1. In Supabase, go to **Settings** (gear icon) → **API**
2. Copy the **Project URL** — it looks like `https://abcdefgh.supabase.co`
   - Save this as `SUPABASE_URL`
3. Under **Project API keys**, find the **service_role** key and click **Reveal**
   - Copy it — it's a long string starting with `eyJ...`
   - Save this as `SUPABASE_KEY`
   - ⚠️ Use the **service_role** key, NOT the anon key

---

## Step 2 — Google Cloud (Drive, Docs, Sheets, Gmail)

### Create the project
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Name it `finance-claims-bot`, click **Create**
4. Make sure your new project is selected in the dropdown

### Enable the required APIs
1. Go to **APIs & Services** → **Library**
2. Search for and enable each of these (click the API name → **Enable**):
   - **Google Drive API**
   - **Google Docs API**
   - **Google Sheets API**
   - **Gmail API**

### Create a Service Account (for Drive, Docs, Sheets)
1. Go to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Name it `finance-claims-service`, click **Create and continue**
4. Skip the optional role/access steps, click **Done**
5. Click on the service account you just created
6. Go to the **Keys** tab → **Add Key** → **Create new key**
7. Choose **JSON**, click **Create**
8. A `.json` file will download to your computer — keep it safe
9. Open that JSON file in a text editor. It looks like:
   ```json
   {
     "type": "service_account",
     "project_id": "...",
     "private_key_id": "...",
     "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...",
     "client_email": "finance-claims-service@....iam.gserviceaccount.com",
     ...
   }
   ```
10. Select all the text in that file (`Ctrl+A`), copy it — this entire JSON blob is your `GOOGLE_SERVICE_ACCOUNT_JSON`

### Share your Google Drive folder with the service account
1. Go to [drive.google.com](https://drive.google.com)
2. Create a folder called `Claims` (or use an existing one)
3. Right-click the folder → **Share**
4. Paste the **client_email** from the JSON file (e.g. `finance-claims-service@....iam.gserviceaccount.com`)
5. Set role to **Editor**, click **Send**
6. Copy the folder ID from the URL: `https://drive.google.com/drive/folders/`**`THIS_PART_IS_THE_ID`**
   - Save this as `GOOGLE_DRIVE_PARENT_FOLDER_ID`

### Create OAuth credentials (for Gmail sending)
1. Go to **APIs & Services** → **OAuth consent screen**
2. Choose **External**, click **Create**
3. Fill in App name (`Finance Claims Bot`), your email for support and developer contact, click **Save and continue** through the remaining steps
4. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
5. Application type: **Web application**
6. Name: `Finance Claims Gmail`
7. Under **Authorised redirect URIs**, click **Add URI** and add: `http://localhost:8080`
8. Click **Create**
9. A popup shows your credentials:
   - **Client ID** — save this as `GMAIL_CLIENT_ID` (ends in `.apps.googleusercontent.com`)
   - **Client Secret** — save this as `GMAIL_CLIENT_SECRET`
   - Click **OK**

### Run the Gmail authorisation script (one-time only)
This generates a refresh token so the backend can send emails from your Gmail account.

1. On your computer, open a terminal in the project folder
2. Install the required library if you haven't already:
   ```
   pip install google-auth-oauthlib
   ```
3. Create a file called `credentials.json` in the `backend/` folder with this content (fill in your values):
   ```json
   {
     "installed": {
       "client_id": "YOUR_GMAIL_CLIENT_ID",
       "client_secret": "YOUR_GMAIL_CLIENT_SECRET",
       "redirect_uris": ["http://localhost:8080"],
       "auth_uri": "https://accounts.google.com/o/oauth2/auth",
       "token_uri": "https://oauth2.googleapis.com/token"
     }
   }
   ```
4. Run the script:
   ```
   python backend/scripts/gmail_auth.py
   ```
5. Your browser will open — sign in with the Gmail account that will send the emails (the Finance Director's Gmail)
6. Click **Allow** on all permission prompts
7. The script prints a refresh token in the terminal — it looks like `1//0gABC...`
   - Save this as `GMAIL_REFRESH_TOKEN`
8. Delete `credentials.json` afterwards — it contains sensitive credentials

---

## Step 3 — Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow the prompts — choose a name and username for your bot
4. BotFather will give you a **bot token** — it looks like `1234567890:ABCDefGHIjklMNOpqrSTUvwxYZ`
   - Save this as `TELEGRAM_BOT_TOKEN`

---

## Step 4 — Deploy the backend (Render)

1. Push this repo to GitHub (if you haven't already)
2. Go to [render.com](https://render.com) and sign in
3. Click **New** → **Web Service**
4. Connect your GitHub account and select this repo
5. Fill in the settings:
   - **Name**: `finance-claims-bot`
   - **Root Directory**: `backend`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: Free
6. Click **Advanced** → **Add Environment Variable** and add each of the following:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Your Supabase Project URL from Step 1 |
| `SUPABASE_KEY` | Your Supabase service_role key from Step 1 |
| `TELEGRAM_BOT_TOKEN` | Your bot token from Step 3 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The entire JSON file contents from Step 2 (the whole blob) |
| `GMAIL_CLIENT_ID` | From Step 2 |
| `GMAIL_CLIENT_SECRET` | From Step 2 |
| `GMAIL_REFRESH_TOKEN` | From Step 2 |
| `GOOGLE_DRIVE_PARENT_FOLDER_ID` | The Drive folder ID from Step 2 |
| `ACADEMIC_YEAR` | `2526` |
| `ALLOWED_ORIGINS` | `*` |

7. Click **Create Web Service**
8. Wait for the first deploy to finish (~3–5 minutes)
9. Copy your Render URL from the top of the page — it looks like `https://finance-claims-bot.onrender.com`

---

## Step 5 — Deploy the frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **Add New** → **Project**
3. Import your GitHub repo
4. Set **Root Directory** to `frontend`
5. Under **Environment Variables**, add:

| Key | Value |
|-----|-------|
| `VITE_API_URL` | Your Render URL from Step 4 (e.g. `https://finance-claims-bot.onrender.com`) |

6. Click **Deploy**
7. Wait for it to finish (~1–2 minutes)
8. Copy your Vercel URL — it looks like `https://finance-claims-bot.vercel.app`

---

## Step 6 — Connect the Mini App to Telegram

1. Go back to **@BotFather** on Telegram
2. Send `/newapp`
3. Select your bot
4. Follow the prompts — when asked for the Web App URL, enter your **Vercel URL** from Step 5
5. BotFather will confirm the Mini App is created

---

## Step 7 — Add MINI_APP_URL to Render

Now that you have the Vercel URL, go back to Render:

1. Go to your `finance-claims-bot` service → **Environment** tab
2. Click **Add Environment Variable**:

| Key | Value |
|-----|-------|
| `MINI_APP_URL` | Your Vercel URL from Step 5 (e.g. `https://finance-claims-bot.vercel.app`) |
| `RENDER_EXTERNAL_URL` | Your Render URL from Step 4 (e.g. `https://finance-claims-bot.onrender.com`) |

3. Click **Save Changes** — Render will redeploy automatically

---

## Step 8 — GitHub Actions keepalive

This prevents Supabase and Render from going inactive.

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `RENDER_URL`, Value: your Render URL (e.g. `https://finance-claims-bot.onrender.com`)
4. Click **Add secret**

The workflow runs automatically every Sunday. You can also trigger it manually from **Actions** → **Keep Alive** → **Run workflow**.

---

## Step 9 — Register yourself as Finance Director

1. Open Telegram, find your bot, send `/start`
2. The bot won't recognise you yet — it will show your Telegram ID in the reply
3. Send this command (replace with your actual name and email):
   ```
   /register_director Your Name your@email.com
   ```
   Example: `/register_director Jane Doe jane@u.nus.edu`
4. The bot will confirm and show an "Open Claims App" button
5. Tap the button — the Mini App should open

---

## Adding team members

1. Have the new member open your bot and send `/start`
   - The bot will reply with their Telegram ID
2. Send this from your account:
   ```
   /confirm_member <their_telegram_id> Their Name their@email.com member
   ```
   Example: `/confirm_member 123456789 John Lim john@u.nus.edu member`

---

## If the bot stops responding

1. Go to [render.com](https://render.com)
2. Find your `finance-claims-bot` service
3. Click **Manual Deploy** → **Deploy latest commit**
4. Wait ~2 minutes

This happens because Render free tier spins down after inactivity. The weekly GitHub Actions ping reduces how often this occurs.
