"""FF10 Family Help HTTP and single-use-ticket WSS API."""
from __future__ import annotations

from fastapi import APIRouter, Query, Request, Response, WebSocket

from models.family_assist import CreateFamilyAssistSession, FamilyAssistCapabilities, NativeStateCommand, RespondFamilyAssistSession, RevisionCommand
from services.family_assist import sessions
from services.family_assist.config import capability_record
from services.family_assist.relay_credentials import RelayCredentialError, issue_relay_credentials, unavailable_http
from services.family_assist.signaling import hub, serve

router = APIRouter(prefix="/family/assist", tags=["family-assist"])
ws_router = APIRouter(prefix="/family/assist", tags=["family-assist-signaling"])


@router.get("/capabilities", response_model=FamilyAssistCapabilities)
async def capabilities(): return capability_record()


@router.get("/invitations")
async def invitations(request: Request): return await sessions.invitations(request.state.device["device_id"])


@router.post("/sessions", status_code=201)
async def create(body: CreateFamilyAssistSession, request: Request): return await sessions.create_session(request.state.device["device_id"], body)


@router.get("/sessions/{session_id}")
async def get(session_id: str, request: Request): return sessions.view(await sessions.get_session(session_id, request.state.device["device_id"]), request.state.device["device_id"])


@router.post("/sessions/{session_id}/respond")
async def respond(session_id: str, body: RespondFamilyAssistSession, request: Request): return await sessions.respond(session_id, request.state.device["device_id"], body)


@router.post("/sessions/{session_id}/signaling-ticket")
async def ticket(session_id: str, request: Request): return await sessions.issue_ticket(session_id, request.state.device["device_id"])


@router.post("/sessions/{session_id}/relay-credentials")
async def relay(session_id: str, request: Request, response: Response):
    caller = request.state.device["device_id"]; row = await sessions.get_session(session_id, caller)
    response.headers["Cache-Control"] = "no-store"
    try:
        return await issue_relay_credentials(row, caller, sessions.role_for_device(row, caller))
    except RelayCredentialError:
        raise unavailable_http()


@router.post("/sessions/{session_id}/pause")
async def pause(session_id: str, body: RevisionCommand, request: Request): return await sessions.transition(session_id, request.state.device["device_id"], body.expected_revision, "pause")


@router.post("/sessions/{session_id}/resume")
async def resume(session_id: str, body: RevisionCommand, request: Request): return await sessions.transition(session_id, request.state.device["device_id"], body.expected_revision, "resume")


@router.post("/sessions/{session_id}/extend")
async def extend(session_id: str, body: RevisionCommand, request: Request): return await sessions.transition(session_id, request.state.device["device_id"], body.expected_revision, "extend")


@router.post("/sessions/{session_id}/native-state")
async def native_state(session_id: str, body: NativeStateCommand, request: Request):
    return await sessions.publish_native_state(session_id, request.state.device["device_id"], body, await hub.connected(session_id, "helper"))


@router.delete("/sessions/{session_id}")
async def end(session_id: str, request: Request, expected_revision: int | None = Query(default=None, alias="expectedRevision")):
    return await sessions.end_session(session_id, request.state.device["device_id"], expected_revision)


@ws_router.websocket("/sessions/{session_id}/signal")
async def signal(websocket: WebSocket, session_id: str, ticket: str = Query(min_length=32, max_length=256)):
    await serve(websocket, session_id, ticket)