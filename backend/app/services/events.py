import logging

logger = logging.getLogger(__name__)


def log_claim_event(
    db,
    claim_id: str,
    actor_id: str | None,
    event_type: str,
    message: str,
    metadata: dict | None = None,
) -> None:
    """Best-effort audit timeline insert. Never block the claim workflow."""
    try:
        db.table("claim_events").insert({
            "claim_id": claim_id,
            "actor_id": actor_id,
            "event_type": event_type,
            "message": message,
            "metadata": metadata or {},
        }).execute()
    except Exception as exc:
        logger.info("Claim event skipped for %s/%s: %s", claim_id, event_type, exc)
