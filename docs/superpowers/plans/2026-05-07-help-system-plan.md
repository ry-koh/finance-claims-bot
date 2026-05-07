# Help System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-app Q&A system where CCA treasurers submit questions (text + images), finance team members answer within the app, and the asker is notified via Telegram bot.

**Architecture:** Two new Supabase tables (`help_questions`, `help_answers`) + a FastAPI router (`/help`) with 6 endpoints + 5 new React pages. Images are uploaded to Cloudflare R2 under `help/` prefix and served via the existing `/images/view` proxy. Telegram notifications fire asynchronously using the existing `send_bot_notification` helper.

**Tech Stack:** FastAPI, Supabase Python client, Cloudflare R2 (boto3), Telegram Bot API (python-telegram-bot), React 18, TanStack Query v5, React Router v6, Tailwind CSS

---

## File Map

**New files:**
- `supabase/migrations/017_help_system.sql` — creates `help_questions` and `help_answers` tables
- `backend/app/routers/help.py` — all 6 help endpoints
- `frontend/src/api/help.js` — TanStack Query hooks + fetch functions
- `frontend/src/pages/HelpPage.jsx` — treasurer: contact banner, Q&A placeholder, question list
- `frontend/src/pages/HelpNewQuestionPage.jsx` — treasurer: submit question + image upload
- `frontend/src/pages/HelpQuestionDetailPage.jsx` — treasurer: view question + answers
- `frontend/src/pages/HelpInboxPage.jsx` — director/member: all questions list
- `frontend/src/pages/HelpInboxThreadPage.jsx` — director/member: question thread + reply form

**Modified files:**
- `backend/app/main.py` — include help router
- `frontend/src/App.jsx` — add 5 new routes
- `frontend/src/components/Layout.jsx` — add Help tab (treasurer), Help Inbox tab (member), PAGE_TITLES entries
- `frontend/src/components/DirectorDrawer.jsx` — add Help Inbox nav item under Admin group

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/017_help_system.sql`

- [ ] **Step 1: Create migration file**

```sql
create table help_questions (
  id uuid primary key default gen_random_uuid(),
  asker_id uuid not null references finance_team(id) on delete cascade,
  question_text text not null,
  image_urls text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'answered')),
  created_at timestamptz not null default now()
);

create table help_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references help_questions(id) on delete cascade,
  answerer_id uuid not null references finance_team(id) on delete cascade,
  answer_text text not null,
  created_at timestamptz not null default now()
);

create index on help_questions(asker_id);
create index on help_questions(status);
create index on help_answers(question_id);
```

- [ ] **Step 2: Run migration manually**

Open Supabase SQL Editor and run the above SQL. Verify both tables appear in the Table Editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/017_help_system.sql
git commit -m "feat: add help_questions and help_answers tables"
```

---

## Task 2: Backend Help Router

**Files:**
- Create: `backend/app/routers/help.py`

Important notes:
- `require_auth` (from `app.auth`) accepts any registered non-pending user; returns full `finance_team` row with `id`, `name`, `telegram_id`, `role`
- `require_finance_team` blocks treasurers, allows director + member
- `GET /questions/all` must be defined BEFORE `GET /questions/{question_id}` — FastAPI matches routes in registration order
- R2 upload returns the object_name (key like `help/abc.jpg`); store this in `image_urls` array
- `send_bot_notification(telegram_id, text)` from `app.routers.bot` is fire-and-forget async

- [ ] **Step 1: Create `backend/app/routers/help.py`**

```python
import asyncio
import uuid as uuid_lib
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.auth import require_auth, require_finance_team
from app.database import get_supabase
from app.services import r2 as r2_service

router = APIRouter(prefix="/help", tags=["help"])
logger = logging.getLogger(__name__)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


class QuestionCreate(BaseModel):
    question_text: str
    image_urls: list[str] = []


class AnswerCreate(BaseModel):
    answer_text: str


@router.post("/upload")
async def upload_help_image(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_auth),
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    file_bytes = await file.read()
    filename = file.filename or "upload"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    object_name = f"help/{uuid_lib.uuid4()}.{ext}"
    r2_service.upload_file(file_bytes, object_name, file.content_type)
    return {"url": object_name}


@router.get("/questions")
def get_my_questions(
    current_user: dict = Depends(require_auth),
    db=Depends(get_supabase),
):
    qs_resp = (
        db.table("help_questions")
        .select("id, question_text, image_urls, status, created_at")
        .eq("asker_id", current_user["id"])
        .order("created_at", desc=True)
        .execute()
    )
    questions = qs_resp.data or []
    if questions:
        question_ids = [q["id"] for q in questions]
        ans_resp = (
            db.table("help_answers")
            .select("question_id")
            .in_("question_id", question_ids)
            .execute()
        )
        count_map: dict = {}
        for a in (ans_resp.data or []):
            count_map[a["question_id"]] = count_map.get(a["question_id"], 0) + 1
        for q in questions:
            q["answer_count"] = count_map.get(q["id"], 0)
    return questions


@router.post("/questions", status_code=201)
def create_question(
    payload: QuestionCreate,
    current_user: dict = Depends(require_auth),
    db=Depends(get_supabase),
):
    resp = db.table("help_questions").insert({
        "asker_id": current_user["id"],
        "question_text": payload.question_text,
        "image_urls": payload.image_urls,
    }).execute()
    return resp.data[0]


# NOTE: /questions/all MUST be defined before /questions/{question_id}
@router.get("/questions/all")
def get_all_questions(
    current_user: dict = Depends(require_finance_team),
    db=Depends(get_supabase),
):
    qs_resp = (
        db.table("help_questions")
        .select("id, question_text, image_urls, status, created_at, asker_id, asker:finance_team!asker_id(name)")
        .order("status", desc=True)   # 'open' > 'answered' alphabetically; desc=True puts 'open' first
        .order("created_at", desc=True)
        .execute()
    )
    questions = qs_resp.data or []

    if questions:
        # Batch answer counts
        question_ids = [q["id"] for q in questions]
        ans_resp = (
            db.table("help_answers")
            .select("question_id")
            .in_("question_id", question_ids)
            .execute()
        )
        count_map: dict = {}
        for a in (ans_resp.data or []):
            count_map[a["question_id"]] = count_map.get(a["question_id"], 0) + 1

        # Batch CCA names for unique askers
        asker_ids = list({q["asker_id"] for q in questions})
        cca_resp = (
            db.table("treasurer_ccas")
            .select("finance_team_id, ccas(name)")
            .in_("finance_team_id", asker_ids)
            .execute()
        )
        cca_map: dict = {}
        for row in (cca_resp.data or []):
            fid = row["finance_team_id"]
            if fid not in cca_map and row.get("ccas"):
                cca_map[fid] = row["ccas"]["name"]

        for q in questions:
            q["answer_count"] = count_map.get(q["id"], 0)
            q["asker_name"] = (q.get("asker") or {}).get("name", "")
            q["asker_cca"] = cca_map.get(q["asker_id"], "")
            q.pop("asker", None)

    return questions


@router.get("/questions/{question_id}")
def get_question_detail(
    question_id: str,
    current_user: dict = Depends(require_auth),
    db=Depends(get_supabase),
):
    q_resp = (
        db.table("help_questions")
        .select("*")
        .eq("id", question_id)
        .single()
        .execute()
    )
    if not q_resp.data:
        raise HTTPException(status_code=404, detail="Question not found")
    question = q_resp.data

    if question["asker_id"] != current_user["id"]:
        if current_user.get("role") not in ("director", "member"):
            raise HTTPException(status_code=403, detail="Not your question")

    ans_resp = (
        db.table("help_answers")
        .select("id, answer_text, created_at, answerer:finance_team!answerer_id(name)")
        .eq("question_id", question_id)
        .order("created_at")
        .execute()
    )
    answers = []
    for a in (ans_resp.data or []):
        answers.append({
            "id": a["id"],
            "answer_text": a["answer_text"],
            "answerer_name": (a.get("answerer") or {}).get("name", ""),
            "created_at": a["created_at"],
        })
    question["answers"] = answers
    return question


@router.post("/questions/{question_id}/answers", status_code=201)
async def post_answer(
    question_id: str,
    payload: AnswerCreate,
    current_user: dict = Depends(require_finance_team),
    db=Depends(get_supabase),
):
    q_resp = (
        db.table("help_questions")
        .select("id, asker_id, question_text")
        .eq("id", question_id)
        .single()
        .execute()
    )
    if not q_resp.data:
        raise HTTPException(status_code=404, detail="Question not found")
    question = q_resp.data

    ans_resp = db.table("help_answers").insert({
        "question_id": question_id,
        "answerer_id": current_user["id"],
        "answer_text": payload.answer_text,
    }).execute()
    answer = ans_resp.data[0]

    db.table("help_questions").update({"status": "answered"}).eq("id", question_id).execute()

    asker_resp = (
        db.table("finance_team")
        .select("telegram_id")
        .eq("id", question["asker_id"])
        .single()
        .execute()
    )
    if asker_resp.data and asker_resp.data.get("telegram_id"):
        telegram_id = asker_resp.data["telegram_id"]
        q_text = question["question_text"]
        q_preview = q_text[:100] + ("..." if len(q_text) > 100 else "")
        message = (
            f"💬 Your question has been answered!\n\n"
            f"Your question: {q_preview}\n\n"
            f"{current_user['name']} replied:\n{payload.answer_text}"
        )
        from app.routers.bot import send_bot_notification
        asyncio.create_task(send_bot_notification(telegram_id, message))

    return {
        "id": answer["id"],
        "answer_text": answer["answer_text"],
        "answerer_name": current_user["name"],
        "created_at": answer["created_at"],
    }
```

- [ ] **Step 2: Register router in `backend/app/main.py`**

Add after the existing imports and `include_router` calls:

```python
# In the imports section, add:
from app.routers import help as help_router

# In the routers section, add after settings_router:
app.include_router(help_router.router)
```

Full updated imports line (replace the existing one):
```python
from app.routers import bot, claimers, claims, documents, email as email_router, images as images_router, portfolios, receipts
from app.routers import bank_transactions as bank_transactions_router
from app.routers import registration as registration_router
from app.routers import admin as admin_router
from app.routers import messages as messages_router
from app.routers import analytics as analytics_router
from app.routers import settings as settings_router
from app.routers import help as help_router
```

And add to the routers section at line ~109:
```python
app.include_router(help_router.router)
```

- [ ] **Step 3: Verify backend starts**

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Expected: server starts with no import errors. Visit `http://localhost:8000/docs` and confirm `/help/upload`, `/help/questions`, `/help/questions/all`, `/help/questions/{question_id}`, `/help/questions/{question_id}/answers` all appear.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/help.py backend/app/main.py
git commit -m "feat: add help system backend router"
```

---

## Task 3: Frontend API Module

**Files:**
- Create: `frontend/src/api/help.js`

- [ ] **Step 1: Create `frontend/src/api/help.js`**

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from './client'

export const HELP_KEYS = {
  myQuestions: ['help', 'my-questions'],
  allQuestions: ['help', 'all-questions'],
  question: (id) => ['help', 'questions', id],
}

export const fetchMyQuestions = () =>
  api.get('/help/questions').then((r) => r.data)

export const fetchAllQuestions = () =>
  api.get('/help/questions/all').then((r) => r.data)

export const fetchQuestion = (id) =>
  api.get(`/help/questions/${id}`).then((r) => r.data)

export const createQuestion = (data) =>
  api.post('/help/questions', data).then((r) => r.data)

export const postAnswer = (questionId, data) =>
  api.post(`/help/questions/${questionId}/answers`, data).then((r) => r.data)

export const uploadHelpImage = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/help/upload', form).then((r) => r.data)
}

export function useMyQuestions() {
  return useQuery({
    queryKey: HELP_KEYS.myQuestions,
    queryFn: fetchMyQuestions,
    staleTime: 30_000,
  })
}

export function useAllQuestions() {
  return useQuery({
    queryKey: HELP_KEYS.allQuestions,
    queryFn: fetchAllQuestions,
    staleTime: 30_000,
  })
}

export function useQuestion(id) {
  return useQuery({
    queryKey: HELP_KEYS.question(id),
    queryFn: () => fetchQuestion(id),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCreateQuestion(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createQuestion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HELP_KEYS.myQuestions }),
    ...options,
  })
}

export function usePostAnswer(questionId, options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data) => postAnswer(questionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HELP_KEYS.question(questionId) })
      queryClient.invalidateQueries({ queryKey: HELP_KEYS.allQuestions })
    },
    ...options,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/help.js
git commit -m "feat: add help API module"
```

---

## Task 4: HelpPage (Treasurer Question List)

**Files:**
- Create: `frontend/src/pages/HelpPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/HelpPage.jsx`**

```jsx
import { useNavigate } from 'react-router-dom'
import { useMyQuestions } from '../api/help'

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str)
  return isNaN(d) ? str : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function HelpPage() {
  const navigate = useNavigate()
  const { data: questions = [], isLoading } = useMyQuestions()

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
        <p className="text-sm text-gray-700">
          Contact <span className="font-medium">@ry_koh</span> if you have any questions
        </p>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-1">Common Questions</p>
        <p className="text-sm text-gray-400">Coming soon</p>
      </div>

      <div>
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm font-semibold text-gray-900">My Questions</p>
          <button
            onClick={() => navigate('/help/new')}
            className="text-sm text-blue-600 font-medium active:opacity-70"
          >
            + Ask a question
          </button>
        </div>

        {isLoading && (
          <p className="text-sm text-gray-400 text-center py-8">Loading...</p>
        )}

        {!isLoading && questions.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">
            No questions yet. Tap "Ask a question" to get started.
          </p>
        )}

        {questions.map((q) => (
          <div
            key={q.id}
            onClick={() => navigate(`/help/questions/${q.id}`)}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-3 active:bg-gray-50"
          >
            <div className="flex justify-between items-start gap-2 mb-1">
              <p className="text-sm text-gray-900 line-clamp-2 flex-1">{q.question_text}</p>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                  q.status === 'answered'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {q.status === 'answered' ? 'Answered' : 'Open'}
              </span>
            </div>
            <p className="text-xs text-gray-400">{formatDate(q.created_at)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/HelpPage.jsx
git commit -m "feat: add HelpPage for treasurers"
```

---

## Task 5: HelpNewQuestionPage (Ask a Question Form)

**Files:**
- Create: `frontend/src/pages/HelpNewQuestionPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/HelpNewQuestionPage.jsx`**

```jsx
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateQuestion, uploadHelpImage } from '../api/help'

function imageUrl(path) {
  return `${import.meta.env.VITE_API_URL}/images/view?path=${encodeURIComponent(path)}`
}

export default function HelpNewQuestionPage() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [images, setImages] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)
  const createQuestion = useCreateQuestion()

  async function handleFileChange(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    setError(null)
    try {
      const results = await Promise.all(files.map((f) => uploadHelpImage(f)))
      setImages((prev) => [...prev, ...results.map((r) => r.url)])
    } catch {
      setError('Failed to upload image. Please try again.')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function removeImage(idx) {
    setImages((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleSubmit() {
    if (!text.trim()) return
    setError(null)
    createQuestion.mutate(
      { question_text: text.trim(), image_urls: images },
      {
        onSuccess: () => navigate('/help', { replace: true }),
        onError: (err) =>
          setError(err?.response?.data?.detail || 'Failed to submit. Please try again.'),
      }
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Your question
        </label>
        <textarea
          className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={5}
          placeholder="Describe your question..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((url, idx) => (
            <div key={idx} className="relative w-20 h-20">
              <img
                src={imageUrl(url)}
                alt="Attachment"
                className="w-20 h-20 object-cover rounded-lg"
              />
              <button
                onClick={() => removeImage(idx)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-800 text-white rounded-full text-xs flex items-center justify-center leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-sm text-blue-600 font-medium active:opacity-70 disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : '+ Attach images'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={!text.trim() || createQuestion.isPending}
        className="w-full bg-blue-600 text-white text-sm font-semibold py-3 rounded-xl active:bg-blue-700 disabled:opacity-50"
      >
        {createQuestion.isPending ? 'Submitting...' : 'Submit question'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/HelpNewQuestionPage.jsx
git commit -m "feat: add HelpNewQuestionPage"
```

---

## Task 6: HelpQuestionDetailPage (Treasurer View Answers)

**Files:**
- Create: `frontend/src/pages/HelpQuestionDetailPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/HelpQuestionDetailPage.jsx`**

```jsx
import { useParams } from 'react-router-dom'
import { useQuestion } from '../api/help'

function imageUrl(path) {
  return `${import.meta.env.VITE_API_URL}/images/view?path=${encodeURIComponent(path)}`
}

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str)
  return isNaN(d)
    ? str
    : d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

export default function HelpQuestionDetailPage() {
  const { id } = useParams()
  const { data: question, isLoading, error } = useQuestion(id)

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-400 text-center py-8">Loading...</div>
  }
  if (error || !question) {
    return <div className="p-4 text-sm text-red-600">Failed to load question.</div>
  }

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <p className="text-sm text-gray-900 whitespace-pre-wrap mb-3">{question.question_text}</p>
        {question.image_urls?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {question.image_urls.map((url, i) => (
              <img
                key={i}
                src={imageUrl(url)}
                alt="Attachment"
                className="w-20 h-20 object-cover rounded-lg active:opacity-80"
                onClick={() => window.open(imageUrl(url))}
              />
            ))}
          </div>
        )}
        <p className="text-xs text-gray-400">{formatDate(question.created_at)}</p>
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-700 mb-3">
          {question.answers?.length > 0 ? 'Replies' : 'No replies yet'}
        </p>
        {question.answers?.map((a) => (
          <div key={a.id} className="bg-blue-50 rounded-xl p-4 mb-3">
            <p className="text-[11px] font-semibold text-blue-600 mb-1">{a.answerer_name}</p>
            <p className="text-sm text-gray-900 whitespace-pre-wrap mb-2">{a.answer_text}</p>
            <p className="text-xs text-gray-400">{formatDate(a.created_at)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/HelpQuestionDetailPage.jsx
git commit -m "feat: add HelpQuestionDetailPage"
```

---

## Task 7: HelpInboxPage (Director/Member Question List)

**Files:**
- Create: `frontend/src/pages/HelpInboxPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/HelpInboxPage.jsx`**

```jsx
import { useNavigate } from 'react-router-dom'
import { useAllQuestions } from '../api/help'

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str)
  return isNaN(d) ? str : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function HelpInboxPage() {
  const navigate = useNavigate()
  const { data: questions = [], isLoading } = useAllQuestions()

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-400 text-center py-8">Loading...</div>
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      {questions.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No questions yet</p>
      )}
      {questions.map((q) => (
        <div
          key={q.id}
          onClick={() => navigate(`/help-inbox/${q.id}`)}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-3 active:bg-gray-50"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-gray-700">
                {q.asker_name}
                {q.asker_cca ? (
                  <span className="font-normal text-gray-400"> · {q.asker_cca}</span>
                ) : null}
              </p>
              <p className="text-sm text-gray-900 line-clamp-2 mt-0.5">{q.question_text}</p>
            </div>
            <span
              className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                q.status === 'answered'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {q.status === 'answered' ? 'Answered' : 'Open'}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-gray-400">{formatDate(q.created_at)}</p>
            {q.answer_count > 0 && (
              <p className="text-xs text-gray-400">
                {q.answer_count} {q.answer_count === 1 ? 'reply' : 'replies'}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/HelpInboxPage.jsx
git commit -m "feat: add HelpInboxPage for director/members"
```

---

## Task 8: HelpInboxThreadPage (Reply Form)

**Files:**
- Create: `frontend/src/pages/HelpInboxThreadPage.jsx`

- [ ] **Step 1: Create `frontend/src/pages/HelpInboxThreadPage.jsx`**

```jsx
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuestion, usePostAnswer } from '../api/help'

function imageUrl(path) {
  return `${import.meta.env.VITE_API_URL}/images/view?path=${encodeURIComponent(path)}`
}

function formatDate(str) {
  if (!str) return ''
  const d = new Date(str)
  return isNaN(d)
    ? str
    : d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

export default function HelpInboxThreadPage() {
  const { id } = useParams()
  const { data: question, isLoading } = useQuestion(id)
  const [answerText, setAnswerText] = useState('')
  const postAnswer = usePostAnswer(id)

  function handleSend() {
    if (!answerText.trim()) return
    postAnswer.mutate(
      { answer_text: answerText.trim() },
      { onSuccess: () => setAnswerText('') }
    )
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-400 text-center py-8">Loading...</div>
  }
  if (!question) {
    return <div className="p-4 text-sm text-red-600">Question not found.</div>
  }

  return (
    <div className="p-4 pb-4 max-w-lg mx-auto space-y-4">
      <div className="bg-gray-50 rounded-xl p-4">
        <p className="text-sm text-gray-900 whitespace-pre-wrap mb-3">{question.question_text}</p>
        {question.image_urls?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {question.image_urls.map((url, i) => (
              <img
                key={i}
                src={imageUrl(url)}
                alt="Attachment"
                className="w-20 h-20 object-cover rounded-lg active:opacity-80"
                onClick={() => window.open(imageUrl(url))}
              />
            ))}
          </div>
        )}
        <p className="text-xs text-gray-400">{formatDate(question.created_at)}</p>
      </div>

      {question.answers?.length > 0 && (
        <div className="space-y-3">
          {question.answers.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-[11px] font-semibold text-blue-600 mb-1">{a.answerer_name}</p>
              <p className="text-sm text-gray-900 whitespace-pre-wrap mb-2">{a.answer_text}</p>
              <p className="text-xs text-gray-400">{formatDate(a.created_at)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-gray-100 flex gap-2">
        <textarea
          className="flex-1 border border-gray-200 rounded-xl p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={3}
          placeholder="Type a reply..."
          value={answerText}
          onChange={(e) => setAnswerText(e.target.value)}
        />
        <button
          onClick={handleSend}
          disabled={!answerText.trim() || postAnswer.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl active:bg-blue-700 disabled:opacity-50 self-end"
        >
          {postAnswer.isPending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/HelpInboxThreadPage.jsx
git commit -m "feat: add HelpInboxThreadPage with reply form"
```

---

## Task 9: Navigation Wiring

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/Layout.jsx`
- Modify: `frontend/src/components/DirectorDrawer.jsx`

**Context on existing structure:**
- `App.jsx`: treasurers get routes `/`, `/claims/new`, `/claims/:id`; non-treasurers add more routes; directors add approval + admin routes
- `Layout.jsx`: directors get a drawer layout; everyone else gets a bottom nav. Bottom nav currently shows Identifiers + Contact only for `!isTreasurer`
- `DirectorDrawer.jsx`: NAV_GROUPS has Claims, Admin, Other sections

### Step A: Update App.jsx

- [ ] **Step 1: Add imports and routes to `frontend/src/App.jsx`**

Add these imports at the top (after existing imports):
```jsx
import HelpPage from './pages/HelpPage'
import HelpNewQuestionPage from './pages/HelpNewQuestionPage'
import HelpQuestionDetailPage from './pages/HelpQuestionDetailPage'
import HelpInboxPage from './pages/HelpInboxPage'
import HelpInboxThreadPage from './pages/HelpInboxThreadPage'
```

In the treasurer routes block (inside `isTreasurer` branch), add:
```jsx
<Route path="help" element={<HelpPage />} />
<Route path="help/new" element={<HelpNewQuestionPage />} />
<Route path="help/questions/:id" element={<HelpQuestionDetailPage />} />
```

In the non-treasurer block (inside the `else` branch), add:
```jsx
<Route path="help-inbox" element={<HelpInboxPage />} />
<Route path="help-inbox/:id" element={<HelpInboxThreadPage />} />
```

The full updated `App.jsx`:
```jsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import NewClaimPage from './pages/NewClaimPage'
import ClaimDetailPage from './pages/ClaimDetailPage'
import IdentifierDataPage from './pages/IdentifierDataPage'
import RegistrationPage from './pages/RegistrationPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import TreasurerHomePage from './pages/TreasurerHomePage'
import PendingRegistrationsPage from './pages/PendingRegistrationsPage'
import FinanceTeamPage from './pages/FinanceTeamPage'
import CcaTreasurersPage from './pages/CcaTreasurersPage'
import AnalyticsPage from './pages/AnalyticsPage'
import ApprovalWizardPage from './pages/ApprovalWizardPage'
import ContactPage from './pages/ContactPage'
import SettingsPage from './pages/SettingsPage'
import HelpPage from './pages/HelpPage'
import HelpNewQuestionPage from './pages/HelpNewQuestionPage'
import HelpQuestionDetailPage from './pages/HelpQuestionDetailPage'
import HelpInboxPage from './pages/HelpInboxPage'
import HelpInboxThreadPage from './pages/HelpInboxThreadPage'

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorScreen({ onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 px-6 text-center">
      <p className="text-gray-500 text-sm">The server is busy. Please try again in a moment.</p>
      <button
        onClick={onRetry}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg active:bg-blue-700"
      >
        Retry
      </button>
    </div>
  )
}

export default function App() {
  const { user, retryAuth } = useAuth()

  if (user === undefined) return <LoadingScreen />
  if (user.status === 'error') return <ErrorScreen onRetry={retryAuth} />
  if (!user || user.status === 'unregistered') return <RegistrationPage />
  if (user.status === 'pending') return <PendingApprovalPage />

  const isTreasurer = user.role === 'treasurer'
  const isDirector = user.role === 'director'

  return (
    <Routes>
      {!isTreasurer && (
        <Route path="/claims/:id/approve" element={<ApprovalWizardPage />} />
      )}
      <Route path="/" element={<Layout />}>
        {isTreasurer ? (
          <>
            <Route index element={<TreasurerHomePage />} />
            <Route path="claims/new" element={<NewClaimPage />} />
            <Route path="claims/:id" element={<ClaimDetailPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="help/new" element={<HelpNewQuestionPage />} />
            <Route path="help/questions/:id" element={<HelpQuestionDetailPage />} />
          </>
        ) : (
          <>
            <Route index element={<HomePage />} />
            <Route path="claims/new" element={<NewClaimPage />} />
            <Route path="claims/:id" element={<ClaimDetailPage />} />
            <Route path="identifiers" element={<IdentifierDataPage />} />
            <Route path="contact" element={<ContactPage />} />
            <Route path="help-inbox" element={<HelpInboxPage />} />
            <Route path="help-inbox/:id" element={<HelpInboxThreadPage />} />
            {isDirector && (
              <>
                <Route path="pending-registrations" element={<PendingRegistrationsPage />} />
                <Route path="team" element={<FinanceTeamPage />} />
                <Route path="cca-treasurers" element={<CcaTreasurersPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </>
            )}
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
```

### Step B: Update Layout.jsx

- [ ] **Step 2: Update `frontend/src/components/Layout.jsx`**

Changes needed:
1. Add PAGE_TITLES entries for new routes
2. Add dynamic title pattern for `/help-inbox/` and `/help/questions/`
3. Add Help tab to treasurer bottom nav (replacing Contact which they never had anyway)
4. Add Help Inbox tab to non-treasurer, non-director bottom nav

The full updated file:

```jsx
import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { useIsDirector, useIsTreasurer } from '../context/AuthContext'
import { usePendingCount } from '../api/admin'
import DirectorDrawer from './DirectorDrawer'

const PAGE_TITLES = {
  '/': 'Home',
  '/claims/new': 'New Claim',
  '/analytics': 'Analytics',
  '/pending-registrations': 'Approvals',
  '/team': 'Finance Team',
  '/cca-treasurers': 'CCA Treasurers',
  '/settings': 'Settings',
  '/contact': 'Contact',
  '/identifiers': 'Identifiers',
  '/help': 'Help',
  '/help/new': 'Ask a Question',
  '/help-inbox': 'Help Inbox',
}

export default function Layout() {
  const isDirector = useIsDirector()
  const isTreasurer = useIsTreasurer()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const { data: pendingCount = 0 } = usePendingCount()

  const pageTitle =
    PAGE_TITLES[location.pathname] ||
    (location.pathname.startsWith('/claims/') ? 'Claim' :
     location.pathname.startsWith('/help-inbox/') ? 'Question' :
     location.pathname.startsWith('/help/questions/') ? 'My Question' : 'Home')

  if (isDirector) {
    return (
      <div className="flex flex-col h-screen">
        <header className="fixed top-0 left-0 right-0 z-20 h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="relative text-2xl text-gray-700 p-1 -ml-1"
            aria-label="Open menu"
          >
            ☰
            {pendingCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
          <span className="font-semibold text-gray-900 text-base">{pageTitle}</span>
        </header>
        <main className="flex-1 overflow-y-auto pt-14">
          <Outlet />
        </main>
        <DirectorDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-200 flex">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
          }
        >
          <span className="text-xl">🏠</span>
          <span>Home</span>
        </NavLink>
        <NavLink
          to="/claims/new"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
          }
        >
          <span className="text-xl">➕</span>
          <span>New Claim</span>
        </NavLink>
        {isTreasurer ? (
          <NavLink
            to="/help"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
            }
          >
            <span className="text-xl">💬</span>
            <span>Help</span>
          </NavLink>
        ) : (
          <>
            <NavLink
              to="/identifiers"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
              }
            >
              <span className="text-xl">👥</span>
              <span>Identifiers</span>
            </NavLink>
            <NavLink
              to="/contact"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
              }
            >
              <span className="text-xl">💬</span>
              <span>Contact</span>
            </NavLink>
            <NavLink
              to="/help-inbox"
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center py-2 text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`
              }
            >
              <span className="text-xl">📬</span>
              <span>Inbox</span>
            </NavLink>
          </>
        )}
      </nav>
    </div>
  )
}
```

### Step C: Update DirectorDrawer.jsx

- [ ] **Step 3: Update `frontend/src/components/DirectorDrawer.jsx`**

Add `{ to: '/help-inbox', label: 'Help Inbox', icon: '📬' }` to the Admin group, after the Approvals item:

```jsx
import { NavLink } from 'react-router-dom'
import { usePendingCount } from '../api/admin'

const NAV_GROUPS = [
  {
    label: 'Claims',
    items: [
      { to: '/', label: 'Home', icon: '🏠', end: true },
      { to: '/claims/new', label: 'New Claim', icon: '➕' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/analytics', label: 'Analytics', icon: '📊' },
      { to: '/pending-registrations', label: 'Approvals', icon: '👤', badge: true },
      { to: '/help-inbox', label: 'Help Inbox', icon: '📬' },
      { to: '/team', label: 'Finance Team', icon: '🛡️' },
      { to: '/cca-treasurers', label: 'CCA Treasurers', icon: '👥' },
      { to: '/settings', label: 'Settings', icon: '⚙️' },
    ],
  },
  {
    label: 'Other',
    items: [
      { to: '/contact', label: 'Contact', icon: '💬' },
    ],
  },
]

function PendingBadge() {
  const { data: count = 0 } = usePendingCount()
  if (!count) return null
  return (
    <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
      {count > 9 ? '9+' : count}
    </span>
  )
}

export default function DirectorDrawer({ open, onClose }) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed top-0 left-0 h-full w-3/4 max-w-xs bg-white z-40 shadow-xl transform transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b border-gray-100">
          <p className="font-bold text-gray-900 text-base">Menu</p>
        </div>
        <nav className="p-3 overflow-y-auto h-[calc(100%-57px)]">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 px-3 mb-1">
                {group.label}
              </p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium mb-0.5 ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 active:bg-gray-100'
                    }`
                  }
                >
                  <span className="text-lg leading-none">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge && <PendingBadge />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Verify frontend builds**

```bash
cd frontend
npm run build
```

Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/Layout.jsx frontend/src/components/DirectorDrawer.jsx
git commit -m "feat: wire help system routes and navigation"
```

---

## Post-Implementation Verification

After all tasks are committed, do a quick end-to-end check:

1. Start backend: `cd backend && uvicorn app.main:app --reload`
2. Start frontend: `cd frontend && npm run dev`
3. Log in as a **treasurer** — verify bottom nav shows "💬 Help" tab
4. Tap Help → see contact banner + common Q&A placeholder + "My Questions" empty state
5. Tap "Ask a question" → fill text + attach an image → Submit → returns to Help page, question appears with "Open" badge
6. Tap the question → see the question detail, "No replies yet"
7. Log in as **director** → open drawer → see "Help Inbox" under Admin
8. Tap Help Inbox → see the treasurer's question with "Open" badge
9. Tap question → see question thread → type a reply → tap Send → answer appears
10. Verify the treasurer's Telegram receives the notification message
11. Log in as treasurer again → tap question → see the reply with answerer name
12. Question status shows "Answered"
