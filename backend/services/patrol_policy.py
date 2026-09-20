"""Narrow packet evidence and minimal narrative policy, independent of SDK wire shapes."""
import re
from fastapi import HTTPException
from core.db import now_utc


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
    e = body.enforcement_evidence
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
    )
    return payload