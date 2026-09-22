"""Narrow packet evidence and minimal narrative policy, independent of SDK wire shapes."""
import re
from datetime import timezone
from fastapi import HTTPException
from pydantic import ValidationError

from core.db import db, now_utc
from core.models import PatrolEventIn


def domain_only(value):
    return isinstance(value, str) and len(value) <= 253 and bool(re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}', value, re.I))


def packet_verified(body):
    e = body.enforcement_evidence
    if not e or body.category == 'call' or e.platform == 'mock':
        return False
    if e.mechanism not in ('dns_filter', 'vpn_service', 'packet_filter'):
        return False
    if (e.result, e.enforced_action, e.requested_action) != ('verified', 'blocked', 'block'):
        return False
    if e.direction not in ('inbound', 'outbound') or e.protocol not in ('dns', 'tcp', 'udp'):
        return False
    if not domain_only(e.destination_domain) or not e.matched_rule_id or not re.fullmatch(r'[a-zA-Z0-9_.:-]{1,253}', e.matched_rule_id):
        return False
    if not e.destination_port or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}', e.evidence_id):
        return False
    if e.observed_at.tzinfo is None or body.occurred_at.tzinfo is None:
        return False
    if (e.observed_at - now_utc()).total_seconds() > 60 or e.observed_at != body.occurred_at:
        return False
    if (e.device_id and e.device_id != body.device_id) or (e.event_id and e.event_id != body.event_id):
        return False
    return e.mechanism != 'dns_filter' or (e.platform, e.direction, e.protocol, e.destination_port) == ('android', 'outbound', 'dns', 53)


def minimal_patrol(body, verified):
    payload = body.model_dump()
    payload.pop('investigation_case_id', None)  # association has its own owner-validated route
    e = body.enforcement_evidence
    safe_refs = []
    for ref in body.supporting_references[:6]:
        label, url = str(ref.get('label', ''))[:100], str(ref.get('url', ''))[:500]
        if label and url.startswith('https://') and '?' not in url and '#' not in url and '@' not in url:
            safe_refs.append({'label': label, 'url': url})
    if e:
        if e.mechanism == 'call_screening' or not packet_verified(body):
            raise HTTPException(422, 'Only correlated packet-drop evidence may be uploaded')
        for key in ('os_version', 'sdk_version', 'destination_ip', 'app_id', 'process_name', 'threat_id', 'correlation_id'):
            if getattr(e, key) is not None:
                raise HTTPException(422, 'Evidence contains fields outside the minimal privacy boundary')
    # Never persist free-form local narratives from old clients either.
    payload.update(
        headline='Apollo observed a blocked connection' if verified else f'Apollo recorded a {body.category} check',
        what_happened='An observed packet was intentionally blocked by the on-device filter.' if verified else f'The on-device assessment reported {body.state}. Details stay on the device.',
        why=['Packet-backed enforcement evidence is attached.' if verified else 'Only a minimal security summary is shared.'],
        what_to_do='Avoid the suspicious interaction. Review the original alert on your phone.' if body.state == 'barking' else 'Review the original alert on your phone. A past check does not establish current safety.',
        indicator_host=body.indicator_host if body.category != 'call' and domain_only(body.indicator_host) else None,
        claimed_brand=None, scenario=body.scenario if body.scenario and re.fullmatch(r'[A-Z]{1,3}\d{1,3}[a-z]?', body.scenario) else None,
        adapter_label='Apollo on-device assessment', verified_block=verified,
        supporting_references=safe_refs,
    )
    return payload


async def revalidate_stored_patrol(doc: dict) -> dict:
    """Fail closed when old records predate the packet-only truth gate.

    Retrieval is a security boundary too: historical call-screening/manual claims must not keep
    presenting as packet-backed Biting merely because they were persisted by an older release.
    The correction is written back once, while later resolved/trusted status remains intact.
    """
    if doc.get('state') != 'biting' and doc.get('verified_block') is not True:
        return doc
    try:
        body = PatrolEventIn.model_validate(doc)
        # MongoDB stores UTC datetimes without a timezone marker unless the client is configured
        # tz-aware. Reattach UTC for revalidation; never infer a non-UTC zone.
        if body.occurred_at.tzinfo is None:
            body.occurred_at = body.occurred_at.replace(tzinfo=timezone.utc)
        if body.enforcement_evidence and body.enforcement_evidence.observed_at.tzinfo is None:
            body.enforcement_evidence.observed_at = body.enforcement_evidence.observed_at.replace(tzinfo=timezone.utc)
        verified = packet_verified(body)
    except (ValidationError, TypeError, ValueError):
        verified = False
    if verified:
        if doc.get('verified_block') is not True:
            await db.patrol_events.update_one({'_id': doc['_id']}, {'$set': {'verified_block': True}})
            doc = {**doc, 'verified_block': True}
        return doc

    category = doc.get('category') if isinstance(doc.get('category'), str) else 'security'
    status = doc.get('status')
    if status == 'blocked':
        status = 'resolved' if doc.get('resolved_at') else 'active'
    updates = {
        'state': 'barking' if doc.get('state') == 'biting' else doc.get('state', 'barking'),
        'status': status,
        'verified_block': False,
        'headline': 'Apollo recorded a call-screening action' if category == 'call' else 'Apollo recorded a security check',
        'what_happened': 'This historical record does not contain validated packet-drop evidence.',
        'why': ['Only correlated packet-drop evidence can establish Biting.'],
        'what_to_do': 'Review the original alert on your phone. This record does not prove a packet was blocked.',
        'updated_at': now_utc(),
    }
    await db.patrol_events.update_one({'_id': doc['_id']}, {'$set': updates, '$unset': {'enforcement_evidence': ''}})
    return {**doc, **updates, 'enforcement_evidence': None}


async def ensure_evidence_receipt_indexes() -> None:
    """Enforce both identities without ever deleting production receipts during startup."""
    duplicate_groups = await db.evidence_receipts.aggregate([
        {'$group': {'_id': {'device_id': '$device_id', 'event_id': '$event_id'}, 'ids': {'$push': '$_id'}, 'count': {'$sum': 1}}},
        {'$match': {'count': {'$gt': 1}}},
        {'$limit': 1},
    ]).to_list(1)
    if duplicate_groups:
        group = duplicate_groups[0]
        raise RuntimeError(
            f"Duplicate evidence event binding requires explicit reviewed migration: {group['_id']} "
            f"({group['count']} receipts); startup preserved every record"
        )
    await db.evidence_receipts.create_index([('device_id', 1), ('evidence_id', 1)], unique=True)
    await db.evidence_receipts.create_index([('device_id', 1), ('event_id', 1)], unique=True)