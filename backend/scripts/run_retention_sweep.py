"""Operator-controlled one-shot retention maintenance.

Run from a scheduled maintenance job, never from API process startup:
    cd /app/backend && python -m scripts.run_retention_sweep
"""
from __future__ import annotations

import asyncio

from dotenv import load_dotenv

load_dotenv()

from core.db import client  # noqa: E402
from routers.family import sweep_voice_audio  # noqa: E402
from services.higgins import repository  # noqa: E402
from services.higgins.retention import sweep  # noqa: E402


async def main() -> None:
    await sweep()
    await repository.sweep()
    await sweep_voice_audio()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        client.close()