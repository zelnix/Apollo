"""Family audio storage boundary: legacy managed-key service is disconnected.

Owner-controlled object storage credentials and migration access are required.
Existing external objects are not falsely reported erased or migrated.
"""


class StorageError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    raise StorageError(503, "Family voice storage needs owner-managed bucket access and credentials. No audio was stored.")


async def get_object(path: str) -> tuple[bytes, str]:
    raise StorageError(503, "Family voice storage migration requires owner-managed storage access. Historic audio is unavailable.")


def voice_note_path(guardian_device_id: str, note_id: str, ext: str) -> str:
    return f"apollo-v1/family-voice/{guardian_device_id}/{note_id}.{ext}"