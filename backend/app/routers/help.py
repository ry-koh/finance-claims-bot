import asyncio
import uuid as uuid_lib
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.auth import require_auth, require_finance_team, require_director
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
    if not resp.data:
        raise HTTPException(status_code=500, detail="Failed to create question")
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
        .order("status", desc=True)
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
    if not ans_resp.data:
        raise HTTPException(status_code=500, detail="Failed to save answer")
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


@router.delete("/questions/{question_id}", status_code=204)
def delete_question(
    question_id: str,
    _director: dict = Depends(require_director),
    db=Depends(get_supabase),
):
    resp = db.table("help_questions").select("id").eq("id", question_id).single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Question not found")
    db.table("help_questions").delete().eq("id", question_id).execute()
