"""Minimal mirror of gates.ts Account Gate decision logic for focused testing.
This does NOT replace the TypeScript source of truth — it mirrors the three-line decision
so that the backend test suite can verify the contract without a Node runtime."""


def build_gates_and_find(gate_id: str, *, accountBreachConfigured: bool = False) -> dict:
    """Return a dict shaped like the GatePresentation for the requested gate_id.
    Currently only 'account' is implemented (Gate 8)."""
    if gate_id != "account":
        raise ValueError(f"Unsupported gate_id for test helper: {gate_id}")

    # Mirror of gates.ts Account Gate logic:
    # state = input.accountBreachConfigured === true ? "running" : "temporarily_unavailable"
    state = "running" if accountBreachConfigured is True else "temporarily_unavailable"
    limitation = (
        "Account checking responds when triggered — no continuous background monitoring."
        if state == "running"
        else "Live breach lookup is unavailable; alert checks still work."
    )
    return {
        "id": "account",
        "capability": {
            "automatic": {
                "kind": "event_driven",
                "state": state,
                "limitation": limitation,
            },
        },
    }
