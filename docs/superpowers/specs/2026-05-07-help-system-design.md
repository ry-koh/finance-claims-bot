# Help System Design

## Understanding Summary

- **What:** In-app Q&A system where CCA treasurers submit questions (text + images) and Finance Director/Team members answer them
- **Why:** Treasurers need a structured way to ask finance questions; answers are visible in-app and pushed via Telegram bot
- **Who:** CCA treasurers (ask), Finance Director + Finance Team members (answer)
- **Constraints:** Images only (no video); each treasurer sees only their own questions; Telegram notification on each new answer; common Q&A section is an empty placeholder for now
- **Non-goals:** Telegram-side answering, video attachments, public Q&A visible to all treasurers, status transitions beyond open/answered

---

## Architecture

Two new DB tables (`help_questions`, `help_answers`). New router `backend/app/routers/help.py` with 5 endpoints. Two new frontend pages (`HelpPage` for treasurers, `HelpInboxPage` for director/members). Image upload to R2 via new `POST /help/upload` endpoint (same pattern as existing document upload). Telegram notification fires synchronously after answer is saved using existing bot client.

**Tech Stack:** FastAPI, Supabase (Postgres), Cloudflare R2, Telegram Bot API, React 18, TanStack Query v5, Tailwind CSS

---

## Data Model

### `help_questions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK DEFAULT gen_random_uuid() | |
| `asker_id` | UUID NOT NULL → `finance_team.id` | |
| `question_text` | text NOT NULL | |
| `image_urls` | text[] NOT NULL DEFAULT '{}' | R2 URLs |
| `status` | text NOT NULL DEFAULT 'open' | CHECK IN ('open', 'answered') |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

### `help_answers`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK DEFAULT gen_random_uuid() | |
| `question_id` | UUID NOT NULL → `help_questions.id` ON DELETE CASCADE | |
| `answerer_id` | UUID NOT NULL → `finance_team.id` | |
| `answer_text` | text NOT NULL | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

---

## API Endpoints

### `POST /help/upload`
- Auth: any authenticated user
- Accepts: multipart `file` (image only — validated by content type)
- Uploads to R2 under `help/{uuid}.{ext}`
- Returns: `{ url: string }`

### `GET /help/questions`
- Auth: any authenticated user
- Returns caller's own questions only (filtered by `asker_id = current_user.id`), newest first
- Returns: `[{ id, question_text, image_urls, status, created_at, answer_count }]`

### `POST /help/questions`
- Auth: any authenticated user
- Body: `{ question_text: str, image_urls: list[str] }`
- Creates question with `asker_id = current_user.id`
- Returns: created question

### `GET /help/questions/{id}`
- Auth: any authenticated user
- Returns question + answers if `asker_id == current_user.id`, else 403
- Returns: `{ id, question_text, image_urls, status, created_at, answers: [{ id, answer_text, answerer_name, created_at }] }`

### `GET /help/questions/all`
- Auth: director or member only (403 otherwise)
- Returns all questions, open first then newest first
- Returns: `[{ id, question_text, image_urls, status, created_at, asker_name, asker_cca, answer_count }]`

### `POST /help/questions/{id}/answers`
- Auth: director or member only (403 otherwise)
- Body: `{ answer_text: str }`
- Saves answer with `answerer_id = current_user.id`
- Sets question `status = 'answered'`
- Sends Telegram bot message to asker's `telegram_id`:
  ```
  💬 Your question has been answered!

  Your question: {question_text[:100]}...

  {answerer_name} replied:
  {answer_text}
  ```
- Returns: created answer

---

## Frontend Pages

### `HelpPage` (treasurer + regular users)

Route: `/help`

Layout (top to bottom):
1. Grey card: "Contact @ry_koh if you have any questions"
2. Grey card: heading "Common Questions", body "Coming soon"
3. Section heading "My Questions" + "Ask a question" button
4. List of own question cards (question preview, status badge, date)
5. Tap card → `HelpQuestionDetailPage` (or inline expand)

**Ask a question flow:**
- Button navigates to `/help/new` (full-page form)
- Text area for question text
- Image picker: tap to select image → uploads immediately to `POST /help/upload` → shows thumbnail with remove button
- Submit posts `{ question_text, image_urls }` to `POST /help/questions`
- On success: navigate back to `/help`, refetch questions list

**Question detail view** (`/help/questions/:id`):
- Full question text + image thumbnails (tap to expand full-screen)
- Answers list: answerer name, answer text, timestamp
- If no answers: "No replies yet"

### `HelpInboxPage` (director + members only)

Route: `/help-inbox`

- List of all questions: open first, then newest
- Each card: asker name + CCA, question preview (1 line), status badge, answer count, date
- Tap → `/help-inbox/:id` (question thread view):
  - Asker name + CCA at top
  - Full question text + image thumbnails (tap to expand)
  - Answers list: answerer name, answer text, timestamp
  - Text input + "Send" button at bottom
  - Posting answer: calls `POST /help/questions/{id}/answers`, refetches thread

### `HelpNewQuestionPage`

Route: `/help/new`

- Text area (required)
- Image upload: multiple images, each uploaded on selection, shown as thumbnails with × button
- Submit button (disabled if text empty)

---

## Navigation Changes

### Treasurer bottom nav
- Remove "Contact" tab
- Add "Help" tab (💬 icon) pointing to `/help`
- Contact info ("Contact @ry_koh...") moves into HelpPage top banner

### Director drawer
- Add "Help Inbox" under Admin group, after "Approvals"

### `PAGE_TITLES` in `Layout.jsx`
- `/help` → `'Help'`
- `/help/new` → `'Ask a Question'`
- `/help-inbox` → `'Help Inbox'`

### `App.jsx` routes
- `/help` → `HelpPage`
- `/help/new` → `HelpNewQuestionPage`
- `/help/questions/:id` → `HelpQuestionDetailPage`
- `/help-inbox` → `HelpInboxPage`
- `/help-inbox/:id` → `HelpInboxThreadPage`

---

## Files

### New
- `supabase/migrations/017_help_system.sql`
- `backend/app/routers/help.py`
- `frontend/src/api/help.js`
- `frontend/src/pages/HelpPage.jsx`
- `frontend/src/pages/HelpNewQuestionPage.jsx`
- `frontend/src/pages/HelpQuestionDetailPage.jsx`
- `frontend/src/pages/HelpInboxPage.jsx`
- `frontend/src/pages/HelpInboxThreadPage.jsx`

### Modified
- `backend/app/main.py` — include help router
- `frontend/src/App.jsx` — add 5 new routes
- `frontend/src/components/Layout.jsx` — add Help tab for treasurers, remove Contact tab for treasurers
- `frontend/src/components/DirectorDrawer.jsx` — add Help Inbox nav item

---

## Decision Log

| Decision | Alternatives | Reason |
|----------|-------------|--------|
| Separate `help_questions` + `help_answers` tables | Single messages table | Cleaner query for "question + all answers"; simpler auth filtering |
| Upload images before submitting question | Upload on submit | User sees confirmation thumbnails; no orphaned files on failed submits (acceptable trade-off given low volume) |
| Telegram notification fires synchronously | Background task/queue | Low volume, simplest implementation; bot API call is fast |
| Status flips to 'answered' on first answer | Manual status toggle | Covers the common case; Finance Team can always add more answers |
| Contact tab replaced by Help tab | Add Help as 5th tab | Bottom nav already at comfortable width with 4 tabs for treasurers |
| Common Q&A as static placeholder | Skip entirely | Preserves the planned UX without requiring implementation now |
