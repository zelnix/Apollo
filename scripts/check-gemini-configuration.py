"""Fail on active legacy gateways/providers; never print secrets. Not a deployment-readiness claim."""
from pathlib import Path
import argparse
import re
import sys

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--production', action='store_true')
args = parser.parse_args()
errors = []
for path in (ROOT / 'backend').rglob('*.py'):
    if 'tests' in path.parts or '__pycache__' in path.parts:
        continue
    source = path.read_text()
    if re.search(r'\bemergentintegrations\b|\bEMERGENT_(?:LLM|EMAIL|PUSH)_KEY\b|\bLlmChat\b|\b(?:from|import)\s+(?:openai|anthropic|litellm)\b', source):
        errors.append(f'Legacy AI/gateway reference: {path.relative_to(ROOT)}')
for name in ('backend/.env', 'frontend/.env'):
    values = dotenv_values(ROOT / name)
    for key, value in values.items():
        if value and key in {'EMERGENT_LLM_KEY', 'EMERGENT_EMAIL_KEY', 'EMERGENT_PUSH_KEY', 'EMERGENT_INTEGRATIONS_BASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'}:
            errors.append(f'Disallowed configured variable: {name}:{key}')
    if name.startswith('backend'):
        if not values.get('GEMINI_API_KEY'):
            errors.append('Owner GEMINI_API_KEY missing')
        if not values.get('INVESTIGATION_KEY_FILE') or not Path(values['INVESTIGATION_KEY_FILE']).is_file():
            errors.append('Dedicated investigation key file missing')
    if args.production and name.startswith('frontend') and values.get('EXPO_PUBLIC_GUARDDOG_ADAPTER') != 'native':
        errors.append('Production requires the native adapter; preview configuration is not production evidence')
requirements = (ROOT / 'backend/requirements.txt').read_text()
if re.search(r'^(?:emergentintegrations|litellm|openai|anthropic)==', requirements, re.M | re.I):
    errors.append('Disallowed AI/gateway dependency is still installed')
for error in errors:
    print('FAIL:', error)
if not errors:
    print('PASS: owner-key Gemini-only runtime/configuration checks (not full architectural acceptance)')
sys.exit(1 if errors else 0)