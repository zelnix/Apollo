#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
exec python tests/run_round1_user_scenarios.py "$@"