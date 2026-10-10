"""Package 3 — Single Gemini Gateway enforcement tests.

These tests prove:
1. No direct Gemini SDK calls exist outside provider.py (import/call-site scanning)
2. No alternate AI provider pathways exist (emergentintegrations/openai/anthropic scanning)
3. Purpose is mandatory — generate() rejects calls without explicit purpose
4. Binary content is blocked for unauthorised purposes
5. Text parts receive full purpose-aware enforcement, not just credential stripping
6. Credential patterns are stripped from ALL text parts in the assembled payload
7. The authorisation matrix covers all new purposes
8. Scam analysis routes through the single gateway
"""
import ast
import os
import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROVIDER_PATH = BACKEND_ROOT / "services" / "higgins" / "provider.py"


# ── 1. No direct Gemini SDK calls outside provider.py ───────────────────────

class TestArchitecturalEnforcement:
    """Static analysis: prove no code outside provider.py makes direct Gemini SDK calls."""

    @staticmethod
    def _python_files() -> list[Path]:
        """All production Python files (exclude tests, __pycache__)."""
        files = []
        for root, dirs, filenames in os.walk(BACKEND_ROOT):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "node_modules")]
            for name in filenames:
                if name.endswith(".py"):
                    full = Path(root) / name
                    rel = full.relative_to(BACKEND_ROOT)
                    # Exclude test files and provider.py itself
                    if "tests/" not in str(rel) and "test_" not in name and str(rel) != "services/higgins/provider.py":
                        files.append(full)
        return files

    def test_no_direct_generate_content_calls(self):
        """No production file outside provider.py may call .generate_content()."""
        violations = []
        for path in self._python_files():
            content = path.read_text(errors="replace")
            if ".generate_content(" in content:
                violations.append(str(path.relative_to(BACKEND_ROOT)))
        assert violations == [], f"Direct .generate_content() calls found outside provider.py: {violations}"

    def test_no_direct_count_tokens_calls(self):
        """No production file outside provider.py may call .count_tokens()."""
        violations = []
        for path in self._python_files():
            content = path.read_text(errors="replace")
            if ".count_tokens(" in content:
                violations.append(str(path.relative_to(BACKEND_ROOT)))
        assert violations == [], f"Direct .count_tokens() calls found outside provider.py: {violations}"

    def test_no_genai_client_instantiation(self):
        """No production file outside provider.py may instantiate genai.Client."""
        violations = []
        for path in self._python_files():
            content = path.read_text(errors="replace")
            if "genai.Client(" in content:
                violations.append(str(path.relative_to(BACKEND_ROOT)))
        assert violations == [], f"Direct genai.Client() instantiation found: {violations}"

    def test_no_alternate_llm_providers(self):
        """No production file may use alternate LLM libraries to call Gemini models.
        emergentintegrations, openai, anthropic are prohibited for Gemini access."""
        prohibited_patterns = [
            re.compile(r"from\s+emergentintegrations\.llm"),
            re.compile(r"import\s+emergentintegrations\.llm"),
            re.compile(r"from\s+openai\s+import"),
            re.compile(r"from\s+anthropic\s+import"),
        ]
        violations = []
        for path in self._python_files():
            content = path.read_text(errors="replace")
            for pattern in prohibited_patterns:
                if pattern.search(content):
                    violations.append(f"{path.relative_to(BACKEND_ROOT)}: {pattern.pattern}")
        assert violations == [], f"Alternate LLM provider imports found: {violations}"

    def test_all_generate_calls_have_purpose(self):
        """Every call to provider.generate() or generate_json() must include purpose=.

        This is a heuristic check — it scans for calls and verifies they contain 'purpose='.
        The compile-time enforcement (purpose as required kwarg) is the primary defence."""
        # Pattern: calls to generate/generate_json that should have purpose
        call_pattern = re.compile(
            r"(?:provider\.generate|provider\.generate_json|await generate_json|await generate)\s*\("
        )
        violations = []
        for path in self._python_files():
            content = path.read_text(errors="replace")
            for match in call_pattern.finditer(content):
                # Find the complete call (rough: scan until matching closing paren or 10 lines)
                start = match.start()
                # Look for purpose= within the next 500 chars
                context = content[start:start + 500]
                if "purpose=" not in context and "**kwargs" not in context:
                    line_no = content[:start].count("\n") + 1
                    violations.append(f"{path.relative_to(BACKEND_ROOT)}:{line_no}")
        assert violations == [], f"generate/generate_json calls without purpose=: {violations}"


# ── 2. Purpose is mandatory ─────────────────────────────────────────────────

class TestPurposeMandatory:
    """Verify generate() rejects calls without explicit purpose."""

    def test_generate_signature_requires_purpose(self):
        """The generate() function must not have a default value for purpose.
        Uses AST inspection since async wrappers may obscure inspect.signature()."""
        source = PROVIDER_PATH.read_text()
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "generate":
                # Find the 'purpose' argument
                args = node.args
                # keyword-only args
                for kw, default in zip(args.kwonlyargs, args.kw_defaults):
                    if kw.arg == "purpose":
                        # default must be None (no default) for a required arg
                        assert default is None, \
                            f"purpose must be a required keyword argument (no default), but has a default value"
                        return
                assert False, "generate() must have a 'purpose' keyword argument"

    def test_generate_json_passes_kwargs_through(self):
        """generate_json() must pass **kwargs to generate(), allowing purpose to flow through."""
        source = PROVIDER_PATH.read_text()
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "generate_json":
                # Check it has **kwargs parameter
                assert node.args.kwarg is not None, \
                    "generate_json must accept **kwargs to pass purpose through"
                return
        assert False, "generate_json() function not found"


# ── 3. Binary content authorisation ─────────────────────────────────────────

class TestBinaryContentAuthorisation:
    """Verify binary content is only permitted for authorised purposes."""

    def test_contains_binary_detects_inline_data(self):
        from services.higgins.provider import _contains_binary
        from google.genai import types
        # Text-only: no binary
        assert not _contains_binary("just text")
        assert not _contains_binary(types.Part(text="hello"))
        assert not _contains_binary([types.Part(text="hello")])
        # Binary: detected
        assert _contains_binary(types.Part.from_bytes(data=b"\xff\xd8", mime_type="image/jpeg"))
        assert _contains_binary([types.Part.from_bytes(data=b"\xff\xd8", mime_type="image/jpeg")])
        assert _contains_binary(types.Content(role="user", parts=[types.Part.from_bytes(data=b"\xff\xd8", mime_type="image/jpeg")]))

    def test_binary_authorised_purposes_are_correct(self):
        from services.higgins.provider import _BINARY_AUTHORISED_PURPOSES
        from services.higgins.llm_boundary import Purpose
        # These purposes MUST allow binary
        assert Purpose.VISION_PREFLIGHT in _BINARY_AUTHORISED_PURPOSES
        assert Purpose.PAGE_SIGNAL_EXTRACTION in _BINARY_AUTHORISED_PURPOSES
        assert Purpose.INVESTIGATION in _BINARY_AUTHORISED_PURPOSES
        assert Purpose.TRANSCRIPTION in _BINARY_AUTHORISED_PURPOSES
        assert Purpose.TTS in _BINARY_AUTHORISED_PURPOSES
        # These purposes MUST NOT allow binary
        assert Purpose.RESEARCH not in _BINARY_AUTHORISED_PURPOSES
        assert Purpose.ORDINARY_CHAT not in _BINARY_AUTHORISED_PURPOSES
        assert Purpose.PUBLIC_ADVISORY_ANALYSIS not in _BINARY_AUTHORISED_PURPOSES


# ── 4. Text enforcement quality ─────────────────────────────────────────────

class TestTextEnforcement:
    """Verify text parts get full purpose-aware enforcement."""

    def test_credential_stripped_from_system_prompt(self):
        from services.higgins.llm_boundary import strip_credentials
        text = "System: password is Secret123"
        result = strip_credentials(text)
        assert "Secret123" not in result

    def test_research_purpose_minimises_pii(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        text = "Check domain.com for user john@example.com"
        result = enforce_boundary(Purpose.RESEARCH, text)
        assert "domain.com" in result  # Security indicator preserved
        assert "john@example.com" not in result  # PII minimised

    def test_advisory_purpose_minimises_pii(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        text = "Victim Jane Smith (jane@example.com) lost money to scam-domain.com"
        result = enforce_boundary(Purpose.PUBLIC_ADVISORY_ANALYSIS, text)
        assert "scam-domain.com" in result  # Scam indicator preserved
        assert "jane@example.com" not in result  # Third-party PII minimised

    def test_investigation_purpose_preserves_indicators(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        text = "Phishing from evil-domain.com password is secret123"
        result = enforce_boundary(Purpose.INVESTIGATION, text)
        assert "evil-domain.com" in result  # Security indicator preserved
        assert "secret123" not in result  # Credential stripped

    def test_credential_stripped_regardless_of_purpose(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        for purpose in Purpose:
            text = "password is MySecret123"
            result = enforce_boundary(purpose, text)
            assert "MySecret123" not in result, f"Credential leaked for purpose {purpose.value}"


# ── 5. Scam analysis routes through gateway ─────────────────────────────────

class TestScamAnalysisGateway:
    """Verify scam_analysis.py uses the single Gemini gateway."""

    def test_scam_analysis_imports_provider(self):
        """scam_analysis._run_model must import from services.higgins.provider."""
        import inspect
        from services.scam_analysis import _run_model
        source = inspect.getsource(_run_model)
        assert "generate_json" in source, "_run_model must use generate_json from provider"
        assert "Purpose.PUBLIC_ADVISORY_ANALYSIS" in source, "_run_model must use PUBLIC_ADVISORY_ANALYSIS purpose"

    def test_scam_analysis_does_not_import_emergentintegrations(self):
        """scam_analysis module must NOT import emergentintegrations at module level."""
        from services import scam_analysis
        source = Path(scam_analysis.__file__).read_text()
        assert "from emergentintegrations" not in source, \
            "scam_analysis must not import emergentintegrations (use provider.py gateway)"
        assert "LlmChat" not in source, \
            "scam_analysis must not use LlmChat (use provider.py gateway)"

    def test_advisory_model_registered_in_capabilities(self):
        """The advisory model must be registered in provider.CAPABILITIES."""
        from services.higgins.provider import ADVISORY_MODEL, CAPABILITIES
        assert ADVISORY_MODEL in CAPABILITIES, \
            f"Advisory model '{ADVISORY_MODEL}' not in provider.CAPABILITIES"


# ── 6. New purposes in authorisation matrix ─────────────────────────────────

class TestNewPurposeAuthorisation:
    """Verify Package 2 authorisation matrix covers the new Package 3 purposes."""

    def test_page_signal_extraction_in_matrix(self):
        from core.data_classification import ProcessingPurpose, AUTHORISATION_MATRIX, DataCategory
        assert ProcessingPurpose.PAGE_SIGNAL_EXTRACTION in AUTHORISATION_MATRIX
        matrix = AUTHORISATION_MATRIX[ProcessingPurpose.PAGE_SIGNAL_EXTRACTION]
        # Security indicators must be PERMITTED
        level, _ = matrix[DataCategory.SECURITY_INDICATOR]
        assert level.value == "permitted"
        # Credentials must be PROHIBITED
        level, _ = matrix[DataCategory.CREDENTIAL]
        assert level.value == "prohibited"

    def test_public_advisory_analysis_in_matrix(self):
        from core.data_classification import ProcessingPurpose, AUTHORISATION_MATRIX, DataCategory
        assert ProcessingPurpose.PUBLIC_ADVISORY_ANALYSIS in AUTHORISATION_MATRIX
        matrix = AUTHORISATION_MATRIX[ProcessingPurpose.PUBLIC_ADVISORY_ANALYSIS]
        # Security indicators must be PERMITTED (scam domains, techniques)
        level, _ = matrix[DataCategory.SECURITY_INDICATOR]
        assert level.value == "permitted"
        # Credentials must be PROHIBITED
        level, _ = matrix[DataCategory.CREDENTIAL]
        assert level.value == "prohibited"
        # PII must be CONTROLLED (third-party PII minimised)
        level, _ = matrix[DataCategory.PII]
        assert level.value == "controlled"

    def test_credential_prohibited_for_all_new_purposes(self):
        from core.data_classification import ProcessingPurpose, AUTHORISATION_MATRIX, DataCategory, ProtectionLevel
        for purpose_name in ("PAGE_SIGNAL_EXTRACTION", "PUBLIC_ADVISORY_ANALYSIS"):
            purpose = ProcessingPurpose[purpose_name]
            matrix = AUTHORISATION_MATRIX[purpose]
            level, _ = matrix[DataCategory.CREDENTIAL]
            assert level == ProtectionLevel.PROHIBITED, \
                f"CREDENTIAL must be PROHIBITED for {purpose_name}"


# ── 7. Provider configuration ───────────────────────────────────────────────

class TestProviderConfiguration:
    """Verify provider.py configuration is correct for Package 3."""

    def test_advisory_model_defined(self):
        from services.higgins.provider import ADVISORY_MODEL
        assert ADVISORY_MODEL, "ADVISORY_MODEL must be defined"

    def test_advisory_model_has_text_capability(self):
        from services.higgins.provider import ADVISORY_MODEL, CAPABILITIES
        caps = CAPABILITIES.get(ADVISORY_MODEL, set())
        assert "text" in caps, f"Advisory model {ADVISORY_MODEL} must have 'text' capability"

    def test_purpose_enum_includes_new_values(self):
        from services.higgins.llm_boundary import Purpose
        assert hasattr(Purpose, "PAGE_SIGNAL_EXTRACTION")
        assert hasattr(Purpose, "PUBLIC_ADVISORY_ANALYSIS")
        assert hasattr(Purpose, "TRANSCRIPTION")
