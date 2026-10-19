"""Credential migration: remove disallowed legacy service variables without displaying values.

Only these obsolete keys are touched; database, framework and owner credentials are preserved.
"""
import argparse
from dotenv import unset_key

parser = argparse.ArgumentParser()
parser.add_argument("--env-file", required=True)
args = parser.parse_args()
for name in ("EMERGENT_LLM_KEY", "EMERGENT_EMAIL_KEY", "EMERGENT_PUSH_KEY", "EMERGENT_INTEGRATIONS_BASE_URL", "INTEGRATION_PROXY_URL"):
    unset_key(args.env_file, name)
print("Legacy service configuration removed. No credential values displayed.")