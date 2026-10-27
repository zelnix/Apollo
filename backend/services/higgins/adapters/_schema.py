"""ApolloSG's response shape (services/higgins/response_schema.py) as the strict JSON Schema that Claude's and OpenAI's
structured outputs accept. The shape itself doesn't change: every object is closed (additionalProperties: false) with
all its properties listed as required, and a value the shape lets be null (or leaves out) is a JSON-Schema null union,
so the model returns null for it. Claude's structured outputs take no array length limits, so for Claude a limit is
moved into the field's description; ApolloSG's validator still enforces it on the answer.
"""
from __future__ import annotations


def strict(node: dict, *, array_limits: bool) -> dict:
    kind = node["type"]
    out: dict = {"description": node["description"]} if "description" in node else {}
    if kind == "object":
        required = set(node.get("required", ()))
        props = {name: strict(child if name in required else {**child, "nullable": True}, array_limits=array_limits)
                 for name, child in node.get("properties", {}).items()}
        out.update(type="object", properties=props, required=list(props), additionalProperties=False)
    elif kind == "array":
        out.update(type="array", items=strict(node["items"], array_limits=array_limits))
        if "maxItems" in node:
            if array_limits:
                out["maxItems"] = node["maxItems"]
            else:
                out["description"] = f"{out.get('description', '')} At most {node['maxItems']} items.".strip()
    else:
        out["type"] = kind
        if "enum" in node:
            out["enum"] = list(node["enum"])
    if node.get("nullable"):
        if kind in ("object", "array"):
            description = out.pop("description", None)
            out = {"anyOf": [out, {"type": "null"}], **({"description": description} if description else {})}
        else:
            out["type"] = [kind, "null"]
            if "enum" in out:
                out["enum"] = [*out["enum"], None]
    return out
