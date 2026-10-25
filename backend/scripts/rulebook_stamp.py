"""Record that content/rulebook.md has been reviewed against the code.

Run this only after updating the rule book to match a rule or process change:
    cd backend && python scripts/rulebook_stamp.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import rulebook  # noqa: E402

before = rulebook.changed()
rulebook.stamp()
print("Rule book stamped." + (f" Reviewed changes in: {', '.join(before)}" if before else " Nothing had changed."))
