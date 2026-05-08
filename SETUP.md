# Finance Claims Bot — Setup Guide

Complete one-time setup. Do steps in order — each depends on the previous.

---

## Step 1 — Supabase (Database)

### Create the project
1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **New project**
3. Give it a name (e.g. `finance-claims`), set a database password, choose a region close to Singapore
4. Wait ~2 minutes for it to provision

### Run the database migrations
1. In your Supabase project, click **SQL Editor** in the left sidebar → **New query**
2. Run each file in the `supabase/migrations/` folder **in numerical order** by pasting its contents and clicking **Run**:
   - `001_schema.sql` through `020_analytics_fund_breakdown_fn.sql`
   - Full list: `001` `002` `003` `004` `005` `006` `007` `008` `009` `010` `011` `012` `013` `014` `015` `016` `017` `018` `019` `020`
3. You should see "Success. No rows returned" for each

### Copy your credentials
1. Go to **Settings** → **API**
2. Copy the **Project URL** (e.g. `https://abcdefgh.supabase.co`) → save as `SUPABASE_URL`
3. Under **Project API keys**, reveal the **service_role** key → save as `SUPABASE_KEY`
   - ⚠️ Use **service_role**, NOT the anon key

---

## Step 2 — Google Cloud (Drive, Docs, Sheets, Gmail)

### Create the project
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown → **New Project**
3. Name it `finance-claims-bot`, click **Create**
4. Make sure your new project is selected

### Enable the required APIs
Go to **APIs & Services** → **Library** and enable each:
- Google Drive API
- Google Docs API
- Google Sheets API
- Gmail API

### Create a Service Account (still required by the backend)
1. Go to **IAM & Admin** → **Service Accounts** → **Create Service Account**
2. Name it `finance-claims-service`, click through and **Done**
3. Click the service account → **Keys** tab → **Add Key** → **Create new key** → **JSON**
4. A `.json` file downloads — open it in a text editor
5. Select all (`Ctrl+A`) and copy the entire JSON blob → save as `GOOGLE_SERVICE_ACCOUNT_JSON`

### Share your Google Drive folder with the service account
1. Go to [drive.google.com](https://drive.google.com) and create a folder called `Claims`
2. Right-click → **Share**, paste the `client_email` from the JSON (e.g. `finance-claims-service@....iam.gserviceaccount.com`)
3. Set role to **Editor**, click **Send**
4. Copy the folder ID from the URL: `https://drive.google.com/drive/folders/`**`THIS_PART`** → save as `GOOGLE_DRIVE_PARENT_FOLDER_ID`

### Create OAuth credentials (for Gmail and Drive)
1. Go to **APIs & Services** → **OAuth consent screen** → **External** → **Create**
2. Fill in App name (`Finance Claims Bot`), your email for support and developer contact, save through the steps
3. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
4. Application type: **Web application**, Name: `Finance Claims Bot`
5. Under **Authorised redirect URIs** add: `http://localhost:8080`
6. Click **Create** — a popup shows:
   - **Client ID** → save as `GMAIL_CLIENT_ID`
   - **Client Secret** → save as `GMAIL_CLIENT_SECRET`

### Generate the Gmail refresh token (send emails as Finance Director)
This authorises the backend to send emails from the FD's Gmail account.

1. In a terminal in the project folder:
   ```
   pip install google-auth-oauthlib
   ```
2. Create `backend/credentials.json`:
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
3. Run:
   ```
   python backend/scripts/gmail_auth.py
   ```
4. Your browser opens — sign in as the **Finance Director's Gmail account** and click Allow
5. The terminal prints a refresh token → save as `GMAIL_REFRESH_TOKEN`
6. Delete `backend/credentials.json` afterwards

### Generate the Drive refresh token (read/write Drive, Sheets, Docs)
This is a separate token that authorises document generation and storage in Drive.

1. Run:
   ```
   python backend/scripts/get_drive_token.py
   ```
2. When prompted, enter your `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`
3. Your browser opens — sign in as the account that owns the Drive folder and click Allow
4. The terminal prints a refresh token → save as `DRIVE_REFRESH_TOKEN`

---

## Step 3 — Cloudflare R2 (Image Storage)

R2 stores receipt images, bank transaction screenshots, MF approval scans, exchange rate screenshots, and attachment request files uploaded from the UI.

1. Go to [cloudflare.com](https://cloudflare.com) → **R2 Object Storage** → **Create bucket**
2. Name it (e.g. `finance-claims`) → save the name as `R2_BUCKET_NAME`
3. In R2, go to **Manage R2 API tokens** → **Create API token**
4. Set permissions: **Object Read & Write** for your bucket
5. Save the credentials:
   - **Account ID** → `R2_ACCOUNT_ID`
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`

---

## Step 4 — Telegram Bot

1. Open Telegram → search **@BotFather** → send `/newbot`
2. Follow prompts to choose a name and username
3. BotFather gives you a bot token → save as `TELEGRAM_BOT_TOKEN`

---

## Step 5 — Deploy Backend (Google Cloud Run)

The backend auto-deploys to Cloud Run whenever you push to `main` via GitHub Actions.

### Set up Google Cloud Run
1. In your Google Cloud project, go to **APIs & Services** → **Library** and enable:
   - **Cloud Run API**
   - **Cloud Build API**
   - **Artifact Registry API**
2. Go to **IAM & Admin** → **Service Accounts** → **Create Service Account**
3. Name it `github-deployer`, click **Create and continue**
4. Grant these roles:
   - Cloud Run Admin
   - Service Account User
   - Storage Admin
   - Artifact Registry Administrator
5. Click **Done**
6. Click the service account → **Keys** tab → **Add Key** → **Create new key** → **JSON**
7. Save the downloaded JSON → you'll need its full contents as `GCP_SA_KEY`

### Add GitHub secrets
Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** for each:

| Secret | Value |
|---|---|
| `GCP_PROJECT_ID` | Your Google Cloud project ID (visible in the Cloud Console header) |
| `GCP_SA_KEY` | The entire JSON contents of the deployer service account key file |
| `SUPABASE_URL` | From Step 1 |
| `SUPABASE_KEY` | From Step 1 |
| `TELEGRAM_BOT_TOKEN` | From Step 4 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | From Step 2 |
| `GMAIL_CLIENT_ID` | From Step 2 |
| `GMAIL_CLIENT_SECRET` | From Step 2 |
| `GMAIL_REFRESH_TOKEN` | From Step 2 |
| `GOOGLE_DRIVE_PARENT_FOLDER_ID` | From Step 2 |
| `DRIVE_REFRESH_TOKEN` | From Step 2 |
| `R2_ACCOUNT_ID` | From Step 3 |
| `R2_ACCESS_KEY_ID` | From Step 3 |
| `R2_SECRET_ACCESS_KEY` | From Step 3 |
| `R2_BUCKET_NAME` | From Step 3 |
| `FD_NAME` | Finance Director's full name (e.g. `Jun Kiat`) |
| `FD_MATRIC_NO` | Finance Director's matric number |
| `FD_PHONE` | Finance Director's phone number |
| `FD_EMAIL` | Finance Director's personal email |
| `ACADEMIC_YEAR` | e.g. `2526` |
| `ALLOWED_ORIGINS` | `*` |

> `APP_URL` and `MINI_APP_URL` cannot be set yet — you'll add them in Steps 6–8.

### Trigger the first deploy
1. Push to `main`:
   ```
   git push origin main
   ```
2. Go to **Actions** → **Deploy to Google Cloud Run** → watch the workflow run (~3–5 minutes)
3. When it finishes, the workflow prints your Cloud Run URL (e.g. `https://finance-claims-bot-xxxx-as.a.run.app`)
4. Save this URL → you'll need it as `APP_URL`

---

## Step 6 — Deploy Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) → **Add New** → **Project**
2. Import your GitHub repo
3. Set **Root Directory** to `frontend`
4. Under **Environment Variables** add:

| Key | Value |
|---|---|
| `VITE_API_URL` | Your Cloud Run URL from Step 5 (e.g. `https://finance-claims-bot-xxxx-as.a.run.app`) |

5. Click **Deploy** (~1–2 minutes)
6. Copy your Vercel URL (e.g. `https://finance-claims-bot.vercel.app`) → save as `MINI_APP_URL`

---

## Step 7 — Connect the Mini App to Telegram

1. Go back to **@BotFather** → send `/newapp`
2. Select your bot
3. When asked for the Web App URL, enter your Vercel URL from Step 6
4. BotFather confirms the Mini App is created

---

## Step 8 — Add Remaining GitHub Secrets

Now that you have both URLs, add them as GitHub secrets:

| Secret | Value |
|---|---|
| `APP_URL` | Your Cloud Run URL from Step 5 |
| `MINI_APP_URL` | Your Vercel URL from Step 6 |

Then push a trivial change to `main` (or trigger the workflow manually via **Actions** → **Deploy to Google Cloud Run** → **Run workflow**) so the backend redeploys with `APP_URL` and `MINI_APP_URL` set. This is needed for the Telegram webhook to register on startup.

---

## Step 9 — GitHub Actions Keepalive

The keepalive workflow (`keepalive.yml`) pings `/health` every Sunday to prevent Supabase from going inactive.

It uses the `APP_URL` secret you added in Step 8 — no further action needed. You can trigger it manually at any time via **Actions** → **Keep Alive** → **Run workflow**.

---

## Step 10 — Register Yourself as Finance Director

1. Open Telegram, find your bot, send `/start`
2. The bot won't recognise you yet — it replies with your Telegram ID
3. Send:
   ```
   /register_director Your Name your@email.com
   ```
   Example: `/register_director Jane Doe jane@u.nus.edu`
4. The bot confirms and shows an **Open Claims App** button
5. Tap the button — the Mini App opens

---

## Adding Team Members

1. Have the new member open your bot and send `/start` — the bot replies with their Telegram ID
2. From your account, send:
   ```
   /confirm_member <their_telegram_id> Their Name their@email.com member
   ```
   Example: `/confirm_member 123456789 John Lim john@u.nus.edu member`

---

## If the Bot Stops Responding

The backend is always-on on Cloud Run — it should not go cold. If something breaks:

1. Go to your GitHub repo → **Actions** → **Deploy to Google Cloud Run** → **Run workflow**
2. Wait ~3 minutes for the deploy to complete

To check logs: Google Cloud Console → **Cloud Run** → `finance-claims-bot` → **Logs**.
