import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.evidence_files import normalise_file_ids, remove_file_id, replace_file_id


def test_normalise_file_ids_keeps_legacy_first_without_duplicates():
    assert normalise_file_ids(["new-1", "legacy", "new-1"], "legacy") == ["legacy", "new-1"]


def test_replace_file_id_updates_target_and_keeps_order():
    assert replace_file_id(["first", "old", "last"], "old", "new") == ["first", "new", "last"]


def test_replace_file_id_rejects_missing_target():
    with pytest.raises(ValueError):
        replace_file_id(["first"], "missing", "new")


def test_remove_file_id_updates_first_legacy_value():
    remaining, legacy = remove_file_id(["first", "second"], "first")

    assert remaining == ["second"]
    assert legacy == "second"


def test_remove_file_id_clears_legacy_when_last_file_removed():
    remaining, legacy = remove_file_id(["only"], "only")

    assert remaining == []
    assert legacy is None
