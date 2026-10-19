"""Operator-controlled one-shot maintenance in addition to automatic supervised maintenance.

Run from a scheduled maintenance job, never from API process startup:
    cd /app/backend && python -m scripts.run_retention_sweep
"""
from __future__ import annotations

import asyncio

from dotenv import load_dotenv

load_dotenv()

from core.db import client  # noqa: E402
from services.maintenance import run_maintenance_cycle  # noqa: E402


async def main() -> None:
    await run_maintenance_cycle()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        client.close()