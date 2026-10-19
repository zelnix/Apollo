"""Create a dedicated 0600 key file; no overwrites and no secret output.

Run once with --path on a persistent, protected filesystem. Back up separately;
keep that path across process restarts. API/Gmail keys are never read or changed.
"""
import argparse
import os
from pathlib import Path

from cryptography.fernet import Fernet

parser = argparse.ArgumentParser()
parser.add_argument("--path", required=True)
args = parser.parse_args()
path = Path(args.path)
path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
if path.exists():
    Fernet(path.read_bytes().strip())
    print("Existing investigation key preserved.")
else:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(Fernet.generate_key())
        handle.flush()
        os.fsync(handle.fileno())
    print("Dedicated investigation key created. No key value displayed.")