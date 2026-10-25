"""Run the Apollo KB retrieval benchmark and print its report.

    cd /app/backend && python scripts/kb_benchmark.py          # shipped corpus (deterministic)
    cd /app/backend && python scripts/kb_benchmark.py --live   # the live KB (informational)
    cd /app/backend && python scripts/kb_benchmark.py --record # save the shipped result as the test baseline
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from services import kb_benchmark  # noqa: E402

BASELINE = Path(__file__).resolve().parents[1] / "tests" / "kb_benchmark_baseline.json"


async def main() -> None:
    live = "--live" in sys.argv
    report = await kb_benchmark.run(live=live)
    summary = {k: v for k, v in report.items() if k != "results"}
    print(json.dumps(summary, indent=2))
    if "--record" in sys.argv and not live:
        BASELINE.write_text(json.dumps({k: report[k] for k in ("cases", "mustFind", "top1", "top3", "miss", "irrelevant")}, indent=2) + "\n")
        print(f"baseline saved to {BASELINE}")


asyncio.run(main())
