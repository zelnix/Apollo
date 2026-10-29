"""Check a Number loop cleanup: repeats of the same number inside the gap are one check (first kept)."""
from datetime import datetime, timedelta

from services.loop_cleanup import plan_removals

T0 = datetime(2026, 10, 29, 1, 0, 0)


def _row(case_id, seconds, owner="dev-a", gates=("call",)):
    return {"owner_id": owner, "case_id": case_id, "case_start": T0 + timedelta(seconds=seconds), "gates": list(gates)}


def test_burst_keeps_first_and_hides_the_rest():
    rows = [_row("c1", 0), _row("c2", 6), _row("c3", 12), _row("c4", 130 + 12)]
    material = {c: "Phone number: +61262161111" for c in ("c1", "c2", "c3", "c4")}
    assert plan_removals(rows, material, 120) == {"c2": "c1", "c3": "c1"}


def test_gap_is_measured_from_the_previous_entry_not_the_first():
    rows = [_row(f"c{i}", i * 60) for i in range(5)]  # one every minute for four minutes
    material = {r["case_id"]: "Phone number: +2347015542298" for r in rows}
    assert plan_removals(rows, material, 120) == {"c1": "c0", "c2": "c0", "c3": "c0", "c4": "c0"}


def test_different_numbers_owners_and_unknown_material_are_never_merged():
    rows = [_row("a", 0), _row("b", 5), _row("c", 10, owner="dev-b"), _row("d", 15)]
    material = {"a": "Phone number: +1", "b": "Phone number: +2", "c": "Phone number: +1"}
    assert plan_removals(rows, material, 120) == {}


def test_wider_gap_merges_more():
    rows = [_row("a", 0), _row("b", 200)]
    material = {"a": "Phone number: +1", "b": "Phone number: +1"}
    assert plan_removals(rows, material, 120) == {}
    assert plan_removals(rows, material, 300) == {"b": "a"}


def test_a_check_already_in_history_is_the_one_kept():
    rows = [_row("event-only", 0), {**_row("listed", 6), "in_history": True}, _row("later", 12)]
    material = {r["case_id"]: "Phone number: +1" for r in rows}
    assert plan_removals(rows, material, 120) == {"event-only": "listed", "later": "listed"}


def test_the_same_case_from_both_sources_counts_once():
    rows = [_row("a", 0), _row("a", 0), _row("b", 6)]
    material = {"a": "Phone number: +1", "b": "Phone number: +1"}
    assert plan_removals(rows, material, 120) == {"b": "a"}
