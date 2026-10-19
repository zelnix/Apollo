"""Tests for the deterministic Higgins context classifier."""
import unittest

from services.higgins.context_tools import classify_context


class TestContextClassifier(unittest.TestCase):

    # ── No context needed (general knowledge) ────────────────────────────────

    def test_general_security_question(self):
        plan = classify_context("How do phishing scams work?")
        self.assertEqual(plan.label, "general_knowledge")
        self.assertEqual(plan.readers, [])
        print(f"PASS: '{plan.label}' — no readers for general question")

    def test_general_scam_question(self):
        plan = classify_context("What should I do if I get a suspicious text?")
        self.assertEqual(plan.label, "general_knowledge")
        self.assertEqual(plan.readers, [])
        print(f"PASS: general knowledge — no readers")

    # ── Protection status ────────────────────────────────────────────────────

    def test_protection_status_direct(self):
        plan = classify_context("Is Apollo protecting my device?")
        self.assertEqual(plan.label, "protection_status")
        self.assertIn("get_protection_summary", plan.readers)
        self.assertIn("get_gate_states", plan.readers)
        print(f"PASS: protection_status with {plan.readers}")

    def test_protection_running(self):
        plan = classify_context("Is my phone protected?")
        self.assertEqual(plan.label, "protection_status")
        print(f"PASS: protection_status")

    def test_protection_status_alt(self):
        plan = classify_context("Is protection running?")
        self.assertEqual(plan.label, "protection_status")
        print(f"PASS: protection_status (alt phrasing)")

    # ── Current issues (Why growling?) ───────────────────────────────────────

    def test_why_growling(self):
        plan = classify_context("Why is Apollo growling?")
        self.assertEqual(plan.label, "current_issues")
        self.assertIn("get_last_relevant_outcome", plan.readers)
        print(f"PASS: current_issues with {plan.readers}")

    def test_why_barking(self):
        plan = classify_context("Why is Apollo barking?")
        self.assertEqual(plan.label, "current_issues")
        print(f"PASS: current_issues for barking")

    def test_any_issues(self):
        plan = classify_context("Are there any issues?")
        self.assertEqual(plan.label, "current_issues")
        print(f"PASS: current_issues for issues query")

    def test_whats_wrong(self):
        plan = classify_context("What's wrong?")
        self.assertEqual(plan.label, "current_issues")
        print(f"PASS: current_issues for what's wrong")

    # ── Scam Alerts ──────────────────────────────────────────────────────────

    def test_scam_alerts(self):
        plan = classify_context("What are the latest scam alerts?")
        self.assertEqual(plan.label, "scam_alerts")
        self.assertIn("get_new_scams_digest", plan.readers)
        print(f"PASS: scam_alerts with {plan.readers}")

    def test_scam_news(self):
        plan = classify_context("Any new scams going around?")
        self.assertEqual(plan.label, "scam_alerts")
        print(f"PASS: scam_alerts for 'scams going around'")

    # ── Patrol history ───────────────────────────────────────────────────────

    def test_recent_history(self):
        plan = classify_context("What happened recently?")
        self.assertEqual(plan.label, "patrol_history")
        self.assertIn("get_recent_patrol_outcomes", plan.readers)
        print(f"PASS: patrol_history with {plan.readers}")

    def test_show_recent_findings(self):
        plan = classify_context("Show me my recent findings")
        self.assertEqual(plan.label, "patrol_history")
        print(f"PASS: patrol_history")

    # ── Investigation explanation ────────────────────────────────────────────

    def test_explain_investigation(self):
        plan = classify_context("Explain this investigation")
        self.assertEqual(plan.label, "investigation_explain")
        self.assertIn("get_recent_cases", plan.readers)
        print(f"PASS: investigation_explain with {plan.readers}")

    def test_explain_investigation_with_report(self):
        plan = classify_context("Explain this investigation", has_selected_report=True)
        self.assertEqual(plan.label, "investigation_report_context")
        self.assertEqual(plan.readers, [])
        print(f"PASS: investigation_report_context (report already injected)")

    # ── Product info ─────────────────────────────────────────────────────────

    def test_what_does_apollo_do(self):
        plan = classify_context("What does Apollo do?")
        self.assertEqual(plan.label, "product_info")
        self.assertIn("get_product_capabilities", plan.readers)
        print(f"PASS: product_info with {plan.readers}")

    # ── Learn articles ───────────────────────────────────────────────────────

    def test_learn_phishing(self):
        plan = classify_context("How can I recognise a phone scam?")
        self.assertEqual(plan.label, "learn_articles")
        self.assertIsNotNone(plan.learn_query)
        print(f"PASS: learn_articles query='{plan.learn_query}'")

    def test_learn_types_of_scam(self):
        plan = classify_context("What types of scams are there?")
        self.assertEqual(plan.label, "learn_articles")
        print(f"PASS: learn_articles for types of scams")

    def test_show_articles(self):
        plan = classify_context("Show me what you've got about phishing.")
        self.assertEqual(plan.label, "learn_articles")
        print(f"PASS: learn_articles for 'show me what you've got'")

    # ── Device info ──────────────────────────────────────────────────────────

    def test_device_version(self):
        plan = classify_context("What version of Android am I running?")
        self.assertEqual(plan.label, "device_info")
        print(f"PASS: device_info")

    # ── No false-positive investigation ──────────────────────────────────────

    def test_ambiguous_not_investigation(self):
        """An ambiguous conversational message should NOT route to investigation."""
        plan = classify_context("Thanks, that's helpful.")
        self.assertEqual(plan.label, "general_knowledge")
        self.assertEqual(plan.readers, [])
        print(f"PASS: general_knowledge for conversational message")

    def test_greeting_not_investigation(self):
        plan = classify_context("Hello")
        self.assertEqual(plan.label, "general_knowledge")
        self.assertEqual(plan.readers, [])
        print(f"PASS: general_knowledge for greeting")


if __name__ == "__main__":
    unittest.main(verbosity=2)
