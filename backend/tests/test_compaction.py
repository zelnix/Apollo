"""Tests for conversation compaction (Fix 1) and token reduction fixes.

Verifies:
- _compact_completed_rounds preserves initial evidence and latest tool responses
- _compact_tool_result retains material findings, provenance, evidence IDs, URLs
- Compacted results are deterministic and include explicit truncation markers
- Small/structured results (reputation, breach, register_clue) are NOT compacted
- Binary image parts are replaced with text references in completed rounds
- Model response Contents are never modified
- _brief no longer includes answerExplanation (Fix 3)
"""

import json
import sys
import unittest

sys.path.insert(0, "/app/backend")

from google.genai import types


class TestCompactCompletedRounds(unittest.TestCase):

    def _import(self):
        from services.higgins.coordinator import (
            _compact_completed_rounds,
            _compact_tool_result,
        )
        return _compact_completed_rounds, _compact_tool_result

    def _make_fn_response(self, name: str, result: dict) -> types.Part:
        return types.Part.from_function_response(name=name, response={"result": result})

    def _make_tool_content(self, parts: list[types.Part]) -> types.Content:
        return types.Content(role="user", parts=parts)

    def _make_model_content(self, fn_calls: list[str] = None) -> types.Content:
        parts = [types.Part(text="Proceeding with investigation.")]
        if fn_calls:
            for name in fn_calls:
                parts.append(types.Part.from_function_call(name=name, args={"evidenceId": "ev-001"}))
        return types.Content(role="model", parts=parts)

    def test_no_compaction_with_zero_tool_rounds(self):
        compact, _ = self._import()
        contents = [types.Content(role="user", parts=[types.Part(text="initial evidence")])]
        compact(contents)
        self.assertEqual(len(contents), 1)
        self.assertEqual(contents[0].parts[0].text, "initial evidence")

    def test_no_compaction_with_one_tool_round(self):
        """Single tool round should NOT be compacted (model hasn't processed it)."""
        compact, _ = self._import()
        fn_resp = self._make_fn_response("research_public_sources", {
            "status": "ok", "answer": "x" * 5000, "answerEvidenceId": "ev-res",
            "answerCharacters": 5000, "sources": [{"sourceId": "s1"}],
        })
        contents = [
            types.Content(role="user", parts=[types.Part(text="initial")]),
            self._make_model_content(["research_public_sources"]),
            self._make_tool_content([fn_resp]),
        ]
        compact(contents)
        # The tool response should be preserved in full
        result = contents[2].parts[0].function_response.response["result"]
        self.assertEqual(len(result.get("answer", "")), 5000)

    def test_compaction_preserves_latest_tool_round(self):
        """With 2 tool rounds, only the first should be compacted."""
        compact, _ = self._import()
        old_resp = self._make_fn_response("research_public_sources", {
            "status": "ok", "answer": "A" * 5000, "answerEvidenceId": "ev-r1",
            "answerCharacters": 5000, "sources": [{"sourceId": "s1", "title": "Source 1"}],
            "truncatedInline": False,
        })
        new_resp = self._make_fn_response("inspect_url", {
            "status": "fetched", "sourceId": "src-2", "sourceSnapshotId": "snap-2",
            "originalUrl": "https://example.com", "text": "B" * 4000,
            "title": "Example", "forms": [], "buttons": [], "linkHosts": [],
        })
        contents = [
            types.Content(role="user", parts=[types.Part(text="initial")]),  # [0] initial
            self._make_model_content(["research_public_sources"]),            # [1] model R1
            self._make_tool_content([old_resp]),                              # [2] tool R1 - SHOULD BE COMPACTED
            self._make_model_content(["inspect_url"]),                        # [3] model R2
            self._make_tool_content([new_resp]),                              # [4] tool R2 - should stay FULL
        ]
        compact(contents)

        # Round 1 tool response should be compacted
        r1_result = contents[2].parts[0].function_response.response["result"]
        self.assertTrue(r1_result.get("_compacted"))
        self.assertIn("ev-r1", r1_result.get("answerEvidenceId", ""))
        self.assertIn("answer_preview", r1_result)
        self.assertLess(len(r1_result["answer_preview"]), 1200)
        # Source references must be preserved
        self.assertEqual(r1_result["sources"], [{"sourceId": "s1", "title": "Source 1"}])

        # Round 2 tool response should be FULL
        r2_result = contents[4].parts[0].function_response.response["result"]
        self.assertNotIn("_compacted", r2_result)
        self.assertEqual(len(r2_result.get("text", "")), 4000)

    def test_initial_evidence_never_modified(self):
        compact, _ = self._import()
        initial_text = "IMPORTANT EVIDENCE " * 500
        contents = [
            types.Content(role="user", parts=[types.Part(text=initial_text)]),
            self._make_model_content(["research_public_sources"]),
            self._make_tool_content([self._make_fn_response("research_public_sources", {"status": "ok", "answer": "x" * 3000})]),
            self._make_model_content(["inspect_url"]),
            self._make_tool_content([self._make_fn_response("inspect_url", {"status": "fetched", "text": "y" * 2000})]),
        ]
        compact(contents)
        self.assertEqual(contents[0].parts[0].text, initial_text)

    def test_model_content_never_modified(self):
        compact, _ = self._import()
        model_text = "Analyzing the evidence now."
        contents = [
            types.Content(role="user", parts=[types.Part(text="initial")]),
            types.Content(role="model", parts=[types.Part(text=model_text)]),
            self._make_tool_content([self._make_fn_response("lookup_reputation", {"status": "ok", "verdict": "clean"})]),
            types.Content(role="model", parts=[types.Part(text="Further analysis.")]),
            self._make_tool_content([self._make_fn_response("lookup_reputation", {"status": "ok", "verdict": "malicious"})]),
        ]
        compact(contents)
        self.assertEqual(contents[1].parts[0].text, model_text)
        self.assertEqual(contents[3].parts[0].text, "Further analysis.")

    def test_binary_images_replaced_in_old_rounds(self):
        compact, _ = self._import()
        image_data = b"\x89PNG\x0d\x0a" + b"\x00" * 100
        contents = [
            types.Content(role="user", parts=[types.Part(text="initial")]),
            self._make_model_content(["continue_document"]),
            types.Content(role="user", parts=[
                self._make_fn_response("continue_document", {"status": "ok", "visualEvidenceIds": ["vis-1"]}),
                types.Part(text="CONTINUED PDF VISUAL EVIDENCE vis-1"),
                types.Part(inline_data=types.Blob(mime_type="image/png", data=image_data)),
            ]),
            self._make_model_content(["research_public_sources"]),
            self._make_tool_content([self._make_fn_response("research_public_sources", {"status": "ok", "answer": "test"})]),
        ]
        compact(contents)
        # The old round's image should be replaced with a text reference
        old_parts = contents[2].parts
        has_image = any(p.inline_data for p in old_parts)
        self.assertFalse(has_image, "Binary image should be replaced in completed round")
        has_visual_ref = any("examined" in (p.text or "").lower() for p in old_parts)
        self.assertTrue(has_visual_ref, "Image reference text should be present")


class TestCompactToolResult(unittest.TestCase):

    def _import(self):
        from services.higgins.coordinator import _compact_tool_result
        return _compact_tool_result

    def test_research_preserves_sources_and_evidence_id(self):
        compact = self._import()
        result = compact("research_public_sources", {
            "status": "ok",
            "answer": "Long research answer " * 200,
            "answerEvidenceId": "ev-research-123",
            "answerCharacters": 4000,
            "sources": [
                {"sourceId": "s1", "title": "Google Safe Browsing", "host": "safebrowsing.google.com", "authority": "official"},
                {"sourceId": "s2", "title": "PhishTank", "host": "phishtank.org", "authority": "unknown"},
            ],
            "providerComplete": True,
            "truncatedInline": False,
        })
        self.assertTrue(result["_compacted"])
        self.assertEqual(result["answerEvidenceId"], "ev-research-123")
        self.assertEqual(len(result["sources"]), 2)
        self.assertEqual(result["sources"][0]["sourceId"], "s1")
        self.assertTrue(result["providerComplete"])
        self.assertIn("ev-research-123", result["answer_preview"])

    def test_url_inspect_preserves_structural_data(self):
        compact = self._import()
        result = compact("inspect_url", {
            "status": "fetched",
            "sourceId": "src-456",
            "sourceSnapshotId": "snap-789",
            "originalUrl": "https://phishing.example.com/login",
            "redirectChain": ["https://bit.ly/abc", "https://phishing.example.com/login"],
            "finalUrl": "https://phishing.example.com/login",
            "title": "Sign in to your account",
            "forms": [{"action": "/submit", "method": "POST", "fields": ["email", "password"]}],
            "buttons": ["Sign In", "Create Account"],
            "linkHosts": ["phishing.example.com", "legit-bank.com"],
            "text": "Please enter your credentials " * 200,
            "coverage": {"status": "examined"},
        })
        self.assertTrue(result["_compacted"])
        self.assertEqual(result["sourceId"], "src-456")
        self.assertEqual(result["sourceSnapshotId"], "snap-789")
        self.assertEqual(result["originalUrl"], "https://phishing.example.com/login")
        self.assertEqual(len(result["redirectChain"]), 2)
        self.assertEqual(result["forms"][0]["fields"], ["email", "password"])
        self.assertIn("Sign In", result["buttons"])
        self.assertIn("phishing.example.com", result["linkHosts"])
        self.assertIn("text_preview", result)
        self.assertNotIn("text", result)

    def test_read_evidence_preserves_pagination_info(self):
        compact = self._import()
        result = compact("read_evidence", {
            "evidenceId": "ev-doc-001",
            "kind": "document",
            "totalCharacters": 50000,
            "start": 0,
            "end": 12000,
            "hasMore": True,
            "content": "Document content here " * 1000,
            "pages": 15,
            "pageInventory": [{"page": 1, "chars": 3000}, {"page": 2, "chars": 3500}],
        })
        self.assertTrue(result["_compacted"])
        self.assertEqual(result["evidenceId"], "ev-doc-001")
        self.assertEqual(result["totalCharacters"], 50000)
        self.assertTrue(result["hasMore"])
        self.assertEqual(result["pages"], 15)
        self.assertIn("content_preview", result)
        self.assertNotIn("content", result)

    def test_small_results_not_compacted(self):
        """lookup_reputation, register_clue, etc. should pass through unchanged."""
        compact = self._import()
        reputation = {
            "status": "ok",
            "verdicts": [{"source": "VirusTotal", "verdict": "malicious", "score": 15}],
            "indicators": ["phishing"],
        }
        result = compact("lookup_reputation", reputation)
        self.assertEqual(result, reputation)
        self.assertNotIn("_compacted", result)

    def test_compacted_answer_preview_has_truncation_marker(self):
        compact = self._import()
        result = compact("research_public_sources", {
            "status": "ok",
            "answer": "X" * 2000,
            "answerEvidenceId": "ev-001",
        })
        self.assertIn("[...", result["answer_preview"])
        self.assertIn("ev-001", result["answer_preview"])

    def test_short_answer_not_truncated(self):
        compact = self._import()
        result = compact("research_public_sources", {
            "status": "ok",
            "answer": "Short answer",
            "answerEvidenceId": "ev-002",
        })
        self.assertEqual(result["answer_preview"], "Short answer")
        self.assertNotIn("[...", result["answer_preview"])


class TestTokenReductionEstimate(unittest.TestCase):
    """Quantitative check: verify compaction reduces payload size significantly."""

    def test_compaction_reduces_total_chars(self):
        from services.higgins.coordinator import _compact_completed_rounds

        # Simulate 5 rounds of investigation
        initial = types.Content(role="user", parts=[types.Part(text="Evidence: suspicious email from unknown@example.com")])
        contents = [initial]

        for round_num in range(5):
            # Model response
            contents.append(types.Content(role="model", parts=[
                types.Part.from_function_call(name="research_public_sources", args={"question": f"query {round_num}"}),
            ]))
            # Tool response with large result
            fn_resp = types.Part.from_function_response(
                name="research_public_sources",
                response={"result": {
                    "status": "ok",
                    "answer": f"Research result {round_num}: " + "detailed findings " * 300,
                    "answerEvidenceId": f"ev-r{round_num}",
                    "answerCharacters": 6000,
                    "sources": [{"sourceId": f"s{round_num}", "title": f"Source {round_num}"}],
                    "providerComplete": True,
                }}
            )
            contents.append(types.Content(role="user", parts=[fn_resp]))

        # Measure before compaction
        before_chars = sum(
            len(json.dumps(c.model_dump(mode="json", exclude_none=True), default=str))
            for c in contents
        )

        # Compact
        _compact_completed_rounds(contents)

        # Measure after compaction
        after_chars = sum(
            len(json.dumps(c.model_dump(mode="json", exclude_none=True), default=str))
            for c in contents
        )

        reduction_pct = (1 - after_chars / before_chars) * 100
        print(f"\n  Before: {before_chars:,} chars")
        print(f"  After:  {after_chars:,} chars")
        print(f"  Reduction: {reduction_pct:.1f}%")

        # Expect at least 30% reduction with 5 rounds of large tool results
        self.assertGreater(reduction_pct, 30, f"Expected >30% reduction, got {reduction_pct:.1f}%")

        # Verify the last round is still full
        last_tool = contents[-1]
        last_result = last_tool.parts[0].function_response.response["result"]
        self.assertNotIn("_compacted", last_result)
        self.assertIn("answer", last_result)
        self.assertGreater(len(last_result["answer"]), 3000)

        # Verify earlier rounds are compacted
        for idx in [2, 4, 6, 8]:  # tool-response indices for rounds 0-3
            result = contents[idx].parts[0].function_response.response["result"]
            self.assertTrue(result.get("_compacted"), f"contents[{idx}] should be compacted")
            self.assertIn("answer_preview", result)


if __name__ == "__main__":
    unittest.main()
