from typing import Iterable


def normalise_file_ids(file_ids: Iterable[str] | None, legacy_file_id: str | None = None) -> list[str]:
    """Return ordered, unique file IDs with the legacy single-file ID first."""
    ordered: list[str] = []
    if legacy_file_id:
        ordered.append(legacy_file_id)
    for file_id in file_ids or []:
        if file_id and file_id not in ordered:
            ordered.append(file_id)
    return ordered


def replace_file_id(file_ids: Iterable[str] | None, old_file_id: str, new_file_id: str) -> list[str]:
    ordered = normalise_file_ids(file_ids)
    try:
        index = ordered.index(old_file_id)
    except ValueError as exc:
        raise ValueError("File is not attached") from exc
    ordered[index] = new_file_id
    return ordered


def remove_file_id(file_ids: Iterable[str] | None, file_id: str) -> tuple[list[str], str | None]:
    ordered = normalise_file_ids(file_ids)
    remaining = [current for current in ordered if current != file_id]
    if len(remaining) == len(ordered):
        raise ValueError("File is not attached")
    return remaining, remaining[0] if remaining else None
