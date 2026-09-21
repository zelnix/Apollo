"""Family audio storage boundary: legacy managed-key service is disconnected.

Owner-controlled object storage credentials and migration access are required.
Existing external objects are not falsely reported erased or migrated.
"""


class StorageError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


import asyncio
import os

S3_BUCKET = os.environ.get("FAMILY_STORAGE_BUCKET", "")
S3_ENDPOINT = os.environ.get("FAMILY_STORAGE_ENDPOINT", "") or None
S3_REGION = os.environ.get("FAMILY_STORAGE_REGION", "") or None
S3_KEY = os.environ.get("FAMILY_STORAGE_ACCESS_KEY_ID", "")
S3_SECRET = os.environ.get("FAMILY_STORAGE_SECRET_ACCESS_KEY", "")


def storage_configured() -> bool:
    return bool(S3_BUCKET and S3_KEY and S3_SECRET)


def _client():
    import boto3
    return boto3.client("s3", endpoint_url=S3_ENDPOINT, region_name=S3_REGION, aws_access_key_id=S3_KEY, aws_secret_access_key=S3_SECRET)


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Owner-bucket write (S3-compatible). Server-side encryption requested; the key layout stays owner-private."""
    if not storage_configured():
        raise StorageError(503, "Family voice storage needs owner-managed bucket access and credentials (FAMILY_STORAGE_*). No audio was stored.")
    try:
        await asyncio.to_thread(_client().put_object, Bucket=S3_BUCKET, Key=path, Body=data, ContentType=content_type, ServerSideEncryption="AES256")
    except Exception as exc:  # noqa: BLE001 — provider errors become typed storage failures, never silent success
        raise StorageError(503, f"Family voice storage rejected the upload ({type(exc).__name__}). No audio was stored.") from exc
    return {"path": path, "bytes": len(data), "content_type": content_type}


async def get_object(path: str) -> tuple[bytes, str]:
    if not storage_configured():
        raise StorageError(503, "Family voice storage requires owner-managed storage access. Historic audio is unavailable.")
    try:
        obj = await asyncio.to_thread(_client().get_object, Bucket=S3_BUCKET, Key=path)
        return obj["Body"].read(), obj.get("ContentType", "application/octet-stream")
    except Exception as exc:  # noqa: BLE001
        raise StorageError(404, "This voice note is not available from the owner's storage.") from exc


def voice_note_path(guardian_device_id: str, note_id: str, ext: str) -> str:
    return f"apollo-v1/family-voice/{guardian_device_id}/{note_id}.{ext}"