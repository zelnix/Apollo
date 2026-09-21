#!/usr/bin/env python3
"""Permanent Apollo Round 1 user-scenario runner.

Runs 30 predeclared deterministic situations (threatening, legitimate and ambiguous for every Gate),
then drives one complete browser journey through each Gate plus the corrected popup/handoff/retry flows.
Physical-device-only scenarios are reported separately and never counted as browser completions.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import hashlib
import uuid
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, async_playwright

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
REPORT_DIR = ROOT / "test_reports"
ARTIFACTS = REPORT_DIR / "round1_artifacts"
ENGINE_JSON = REPORT_DIR / "round1_engine.json"


@dataclass
class UiResult:
    id: str
    gate: str
    situation: str
    expected: str
    actual: str
    outcome: str
    evidence: str = "browser"
    artifact: str | None = None
    cause: str | None = None


class BlockedScenario(RuntimeError):
    """A required real downstream service did not return usable evidence in the run budget."""


def compact(value: str, limit: int = 260) -> str:
    return " ".join(value.split())[:limit]


async def visible_text(page: Page, test_id: str) -> str:
    locator = page.get_by_test_id(test_id)
    if await locator.count() == 0:
        return ""
    return compact(await locator.first.inner_text())


async def full_text(page: Page, test_id: str) -> str:
    locator = page.get_by_test_id(test_id)
    if await locator.count() == 0:
        return ""
    return " ".join((await locator.first.inner_text()).split())


class Round1Browser:
    def __init__(self, page: Page, base_url: str, mode: str):
        self.page = page
        self.base = base_url.rstrip("/")
        self.mode = mode
        self.results: list[UiResult] = []
        self.partial_reasons: list[str] = []

    def assert_higgins_meaning(self, response: str, gate: str, supporting_text: str = "", require_gate: bool = True) -> str:
        lower = response.lower()
        support_lower = f"{lower} {supporting_text.lower()}"
        accuracy = (not require_gate or gate in support_lower) and not any(claim in lower for claim in ("i blocked", "safe to open", "verified safe", "apollo is growling", "apollo is barking", "apollo is resting", "settings icon in the top corner", "background patrolling toggle"))
        uncertainty = any(term in support_lower for term in ("unknown", "uncertain", "cannot", "can't", "not confirmed", "not prove", "limited", "could not establish", "requires a decision"))
        action = any(f" {verb} " in f" {support_lower} " for verb in ("do", "open", "keep", "leave", "contact", "review", "remove", "avoid", "use", "check", "change", "deny", "end", "delete", "tap", "turn", "refrain", "navigate", "proceed"))
        clarity = len(response.split()) <= 180
        depth = len(response.split()) >= 20 and any(term in lower for term in ("because", "does not", "doesn't", "not match", "common", "means", "without", "missing", "absence", "determine", "identity", "evidence", "source", "access", "pressure", "permission", "request"))
        assert accuracy, f"Higgins response lost {gate} context or made an unsupported claim. Exact response: {response}"
        assert uncertainty, "Higgins did not preserve uncertainty"
        assert action, "Higgins did not provide a useful action"
        if not clarity:
            self.partial_reasons.append(f"Higgins answer for {gate} exceeded the concise-answer target")
        if not depth:
            self.partial_reasons.append(f"Higgins answer for {gate} did not explain why the evidence mattered")
        return f"accuracy={'yes' if accuracy else 'no'}, uncertainty={'yes' if uncertainty else 'no'}, action={'yes' if action else 'no'}, clarity={'yes' if clarity else 'no'}, depth={'yes' if depth else 'no'}"

    async def open(self, route: str) -> None:
        joiner = "&" if "?" in route else "?"
        await self.page.goto(f"{self.base}{route}{joiner}__apollo_test_setup=1", wait_until="domcontentloaded", timeout=60_000)
        await self.page.wait_for_function("document.querySelector('#root') && document.querySelector('#root').innerText.trim().length > 0", timeout=60_000)

    async def wait_for_any(self, test_ids: tuple[str, ...], timeout: int = 90_000) -> str:
        await self.page.wait_for_function("ids => ids.some(id => document.querySelector(`[data-testid='${id}']`))", arg=list(test_ids), timeout=timeout)
        for test_id in test_ids:
            if await self.page.get_by_test_id(test_id).count():
                return test_id
        raise AssertionError(f"None of the expected result components appeared: {test_ids}")

    async def require_live_investigation(self, prefix: str) -> None:
        mode = await visible_text(self.page, f"{prefix}-investigation-mode")
        if not mode or any(term in mode.lower() for term in ('incomplete', 'fallback', 'partial', 'further research is not', 'supplied-evidence')):
            self.partial_reasons.append(f"{prefix.replace('-assessment', '')} did not show a complete verbatim Gemini assessment: {mode or 'status missing'}")

    async def assessment_trace(self, prefix: str) -> str:
        mode = await full_text(self.page, f"{prefix}-investigation-mode")
        more = self.page.get_by_test_id(f"{prefix}-more-details")
        if await more.count():
            await more.click()
            await self.page.get_by_test_id(f"{prefix}-details").wait_for(timeout=30_000)
        statuses = self.page.locator(f"[data-testid^='{prefix}-source-'][data-testid$='-status']")
        rows = []
        for index in range(await statuses.count()):
            status_id = await statuses.nth(index).get_attribute("data-testid") or ""
            source_root = status_id.removesuffix("-status")
            label = await full_text(self.page, f"{source_root}-label")
            status = compact(await statuses.nth(index).inner_text(), 40)
            detail = await full_text(self.page, f"{source_root}-detail")
            rows.append(f"{label}: {status} — {compact(detail, 180)}")
        return f"Investigation display: {mode or 'missing'}. Sources shown: {' | '.join(rows) if rows else 'none'}"

    @staticmethod
    def higgins_failure(message: str) -> Exception:
        lowered = message.lower()
        if "time limit" in lowered or "could not answer right now" in lowered:
            return BlockedScenario(f"Higgins provider did not return a usable answer: {message}")
        return AssertionError(f"Higgins output was rejected before reaching the user: {message}")

    async def run(self, scenario_id: str, gate: str, situation: str, expected: str, body: Callable[[], Awaitable[str]]) -> None:
        self.partial_reasons = []
        try:
            actual = await body()
            artifact = ARTIFACTS / self.mode / f"{scenario_id}.png"
            artifact.parent.mkdir(parents=True, exist_ok=True)
            await self.page.screenshot(path=str(artifact), full_page=False)
            outcome = "PARTIAL" if self.partial_reasons else "COMPLETE"
            cause = "; ".join(self.partial_reasons) if self.partial_reasons else None
            self.results.append(UiResult(scenario_id, gate, situation, expected, actual, outcome, artifact=str(artifact), cause=cause))
            print(f"{outcome} {scenario_id}: {actual}")
        except BlockedScenario as exc:
            await self.page.context.set_offline(False)
            artifact = ARTIFACTS / self.mode / f"{scenario_id}.png"
            artifact.parent.mkdir(parents=True, exist_ok=True)
            await self.page.screenshot(path=str(artifact), full_page=False)
            self.results.append(UiResult(scenario_id, gate, situation, expected, compact(str(exc)), "BLOCKED", artifact=str(artifact), cause=str(exc)))
            print(f"BLOCKED {scenario_id}: {exc}")
        except Exception as exc:  # noqa: BLE001 - scenario report must continue
            await self.page.context.set_offline(False)
            ARTIFACTS.mkdir(parents=True, exist_ok=True)
            artifact = ARTIFACTS / self.mode / f"{scenario_id}.png"
            artifact.parent.mkdir(parents=True, exist_ok=True)
            try:
                await self.page.screenshot(path=str(artifact), full_page=False)
            except Exception:  # noqa: BLE001
                artifact = None
            message = f"{type(exc).__name__}: {exc}"
            self.results.append(UiResult(scenario_id, gate, situation, expected, compact(message), "FAILED", artifact=str(artifact) if artifact else None, cause=message))
            print(f"FAILED {scenario_id}: {message}")

    async def site(self) -> str:
        await self.open("/(tabs)/guard")
        card_ids = tuple(f"gate-{gate}-card" for gate in ("site", "link", "text", "call", "network", "account", "email", "app", "file", "device"))
        cards = [self.page.get_by_test_id(test_id) for test_id in card_ids]
        await self.page.get_by_test_id("gates-screen").wait_for(timeout=30_000)
        for card in cards:
            await card.wait_for(state="attached", timeout=30_000)
        counts = [await card.count() for card in cards]
        assert all(count == 1 for count in counts), f"10 Gate cards were not all present: {dict(zip(card_ids, counts))}"
        site_text = compact(await cards[0].inner_text())
        await self.open("/(tabs)/home")
        await self.page.get_by_test_id("hero-hear-higgins").click(force=True)
        await self.page.get_by_test_id("hero-checklist-sheet").wait_for(timeout=30_000)
        await self.page.get_by_test_id("higgins-check-device").click()
        await self.page.get_by_test_id("hero-checklist-sheet").wait_for(state="detached", timeout=30_000)
        await self.page.get_by_test_id("device-status").wait_for(timeout=30_000)
        return f"Ten Gates visible; Site card: {site_text}. Recommendation popup dismissed before Device Gate."

    async def link(self) -> str:
        await self.open("/check")
        await self.page.get_by_test_id("check-url-input").fill("https://commbank-secure-verify.xyz/login")
        await self.page.wait_for_function("document.querySelector('[data-testid=check-submit-button]')?.getAttribute('aria-disabled') !== 'true'", timeout=30_000)
        await self.page.get_by_test_id("check-submit-button").click()
        await self.page.get_by_test_id("check-result-card").wait_for(timeout=90_000)
        quality = "not available"
        exact = "not available"
        if await self.page.get_by_test_id("link-assessment").count() == 0:
            investigation_error = await full_text(self.page, "link-investigation-error")
            self.partial_reasons.append(f"real Gemini link investigation was unavailable; the user saw only the local result ({investigation_error or 'no detailed error rendered'})")
        else:
            await self.require_live_investigation("link-assessment")
            exact = await full_text(self.page, "link-assessment-exact-response")
            quality = self.assert_higgins_meaning(exact, "link", await full_text(self.page, "link-assessment"), require_gate=False)
            trace = await self.assessment_trace("link-assessment")
        if await self.page.get_by_test_id("check-result-intel-unavailable").count():
            self.partial_reasons.append("real reputation lookup was unavailable")
        state = await visible_text(self.page, "check-result-state")
        verdict = await visible_text(self.page, "check-result-headline") or await visible_text(self.page, "check-page-verdict")
        await self.page.get_by_test_id("check-verify-website").click()
        await self.page.get_by_test_id("verify-website-sheet").wait_for()
        await self.page.get_by_test_id("verify-website-close").click()
        await self.open("/check")
        await self.page.get_by_test_id("check-url-input").fill("https://bit.ly/example")
        await self.page.get_by_test_id("check-submit-button").click()
        await self.page.get_by_test_id("check-result-card").wait_for(timeout=90_000)
        assert await self.page.get_by_test_id("check-continue-anyway").count() == 1
        label = await self.page.get_by_test_id("check-continue-anyway").inner_text()
        assert "Record my choice" in label
        return f"Threat state {state}; {verdict}; persistent verification instructions opened. Ambiguous shortened-link override label is truthful. Higgins quality: {quality}. Exact live Higgins response: {exact}. {trace if 'trace' in locals() else 'Investigation trace unavailable.'}"

    async def text(self) -> str:
        await self.open("/text-guard")
        await self.page.get_by_test_id("textguard-sender").fill("Bank Security")
        await self.page.get_by_test_id("textguard-text").fill("Your account is locked. Read me the verification code now.")
        await self.page.get_by_test_id("textguard-check").click()
        rendered = await self.wait_for_any(("textguard-result", "message-assessment"))
        if rendered != "message-assessment":
            self.partial_reasons.append("real Gemini message investigation was unavailable; the user saw only the local result")
            quality = "not available"; exact = "not available"
        else:
            await self.require_live_investigation("message-assessment")
            exact = await full_text(self.page, "message-assessment-exact-response")
            quality = self.assert_higgins_meaning(exact, "text", await full_text(self.page, "message-assessment"), require_gate=False)
            trace = await self.assessment_trace("message-assessment")
        state = await visible_text(self.page, "textguard-state") or await visible_text(self.page, "message-assessment-risk-label")
        verdict = await visible_text(self.page, "textguard-verdict") or await visible_text(self.page, "message-assessment-headline")
        await self.page.get_by_test_id("textguard-verify-sender").click()
        await self.page.get_by_test_id("textguard-verify-sheet").wait_for()
        return f"State {state}; {verdict}; sender-check instructions remained visible. Higgins quality: {quality}. Exact live Higgins response: {exact}. {trace if 'trace' in locals() else 'Investigation trace unavailable.'}"

    async def call(self) -> str:
        await self.open("/call")
        await self.page.get_by_test_id("call-claim-bank").click()
        await self.page.get_by_test_id("call-ask-code").click()
        await self.page.get_by_test_id("call-check").click()
        await self.page.get_by_test_id("call-result").wait_for(timeout=30_000)
        state = await visible_text(self.page, "call-state")
        verdict = await visible_text(self.page, "call-verdict")
        action = self.page.get_by_test_id("call-hangup-verify")
        if await action.count() == 0:
            action = self.page.get_by_test_id("call-verify")
        await action.click()
        await self.page.get_by_test_id("verify-caller-sheet").wait_for()
        return f"State {state}; {verdict}; independently trusted callback guidance opened."

    async def network(self) -> str:
        await self.open("/network")
        public = self.page.get_by_test_id("network-context-public")
        if await public.count():
            await public.click()
        await self.page.get_by_test_id("network-run").click()
        await self.page.get_by_test_id("network-result").wait_for(timeout=30_000)
        state = await visible_text(self.page, "network-state")
        verdict = await visible_text(self.page, "network-verdict")
        cannot = await visible_text(self.page, "network-cannot-see")
        assert "blocked" not in verdict.lower() or "confirm" in verdict.lower() or "reported" in verdict.lower()
        return f"State {state}; {verdict}; limitation: {cannot}"

    async def account(self) -> str:
        await self.open("/account")
        await self.page.get_by_test_id("account-no-evidence").click()
        await self.page.get_by_test_id("account-run").click()
        await self.page.get_by_test_id("account-actions").wait_for(timeout=90_000)
        if await self.page.get_by_test_id("account-assessment").count() == 0:
            self.partial_reasons.append("real Gemini account investigation was unavailable; the user saw only the local result")
            quality = "not available"; exact = "not available"
        else:
            await self.require_live_investigation("account-assessment")
            exact = await full_text(self.page, "account-assessment-exact-response")
            if any(claim in exact.lower() for claim in ("malicious code", "tracking pixel", "account is compromised", "delete the message")):
                raise AssertionError(f"Higgins raised an unsupported alarm from an empty submission. Exact response: {exact}")
            quality = self.assert_higgins_meaning(exact, "account", await full_text(self.page, "account-assessment"), require_gate=False)
            trace = await self.assessment_trace("account-assessment")
        root = await self.page.locator("#root").inner_text()
        assert "Login prompt you didn't start" not in root
        await self.page.context.set_offline(True)
        await self.page.get_by_test_id("account-report").click()
        await self.page.get_by_test_id("account-report-error").wait_for(timeout=30_000)
        assert await self.page.get_by_text("Retry report", exact=True).is_visible()
        await self.page.context.set_offline(False)
        await self.page.get_by_test_id("account-report").click()
        await self.page.get_by_test_id("account-report-success").wait_for(timeout=60_000)
        resolve = self.page.get_by_test_id("account-resolve")
        assert await resolve.inner_text() == "Mark as handled"
        return f"No-evidence path stayed unknown; offline report showed Retry; online retry succeeded; resolution label is Mark as handled. Higgins quality: {quality}. Exact live Higgins response: {exact}. {trace if 'trace' in locals() else 'Investigation trace unavailable.'}"

    async def email(self) -> str:
        await self.open("/email")
        await self.page.get_by_test_id("email-from").fill("CommBank <alerts@cb-secure.top>")
        await self.page.get_by_test_id("email-subject").fill("Urgent account lock")
        await self.page.get_by_test_id("email-body").fill("Verify now https://commbank-secure-verify.xyz/login")
        await self.page.get_by_test_id("email-run").click()
        rendered = await self.wait_for_any(("email-result", "email-assessment"))
        if rendered != "email-assessment":
            self.partial_reasons.append("real Gemini email investigation was unavailable; the user saw only the local result")
            quality = "not available"; exact = "not available"
        else:
            await self.require_live_investigation("email-assessment")
            exact = await full_text(self.page, "email-assessment-exact-response")
            quality = self.assert_higgins_meaning(exact, "email", await full_text(self.page, "email-assessment"), require_gate=False)
            trace = await self.assessment_trace("email-assessment")
        state = await visible_text(self.page, "email-state") or await visible_text(self.page, "email-assessment-risk-label")
        verdict = await visible_text(self.page, "email-verdict") or await visible_text(self.page, "email-assessment-headline")
        await self.page.get_by_test_id("email-verify-sender").click()
        await self.page.get_by_test_id("email-verify-sheet").wait_for()
        return f"State {state}; {verdict}; sender verification remained persistent and did not open suspicious content. Higgins quality: {quality}. Exact live Higgins response: {exact}. {trace if 'trace' in locals() else 'Investigation trace unavailable.'}"

    async def app(self) -> str:
        await self.open("/app-check")
        await self.page.get_by_test_id("app-name").fill("Quick Support")
        for test_id in ("app-source-message", "app-purpose-remote_support", "app-perm-accessibility", "app-perm-screen_share", "app-ctx-caller", "app-ctx-access"):
            locator = self.page.get_by_test_id(test_id)
            if await locator.count():
                await locator.click()
        await self.page.get_by_test_id("app-run").click()
        rendered = await self.wait_for_any(("app-result", "app-assessment"))
        if rendered != "app-assessment":
            self.partial_reasons.append("real Gemini app investigation was unavailable; the user saw only the local result")
            quality = "not available"; exact = "not available"
        else:
            await self.require_live_investigation("app-assessment")
            exact = await full_text(self.page, "app-assessment-exact-response")
            quality = self.assert_higgins_meaning(exact, "app", await full_text(self.page, "app-assessment"), require_gate=False)
            trace = await self.assessment_trace("app-assessment")
        state = await visible_text(self.page, "app-state") or await visible_text(self.page, "app-assessment-risk-label")
        verdict = await visible_text(self.page, "app-verdict") or await visible_text(self.page, "app-assessment-headline")
        settings = self.page.get_by_test_id("app-open-settings")
        if await settings.count():
            await settings.click()
            await self.page.get_by_test_id("app-action-guidance").wait_for(timeout=30_000)
        return f"State {state}; {verdict}; Settings action produced persistent guidance in browser. Higgins quality: {quality}. Exact live Higgins response: {exact}. {trace if 'trace' in locals() else 'Investigation trace unavailable.'}"

    async def file(self) -> str:
        await self.open("/file")
        async with self.page.expect_file_chooser() as chooser_info:
            await self.page.get_by_test_id("file-pick").click()
        chooser = await chooser_info.value
        await chooser.set_files(str(ROOT / "test_reports/fixtures/Statement.pdf.exe"))
        await self.page.get_by_test_id("file-source-followup").wait_for(timeout=30_000)
        await self.page.get_by_test_id("file-source-unknown").click()
        await self.page.get_by_test_id("file-finish-check").click()
        await self.page.get_by_test_id("file-actions").wait_for(timeout=60_000)
        file_state = await visible_text(self.page, "file-state")
        file_verdict = await visible_text(self.page, "file-verdict")
        await self.page.get_by_test_id("file-recovery-open").click()
        await self.page.get_by_test_id("file-recovery-pick-clicked").click()
        await self.page.get_by_test_id("file-recovery-sheet").wait_for()
        await self.page.get_by_test_id("file-recovery-close").click()
        await self.page.context.set_offline(True)
        await self.page.get_by_test_id("file-tell-more").click()
        await self.page.get_by_test_id("ask-error-card").wait_for(timeout=30_000)
        assert await self.page.get_by_test_id("ask-conversation-counts").inner_text() == "1 question • 0 completed answers"
        await self.page.context.set_offline(False)
        await self.page.get_by_test_id("ask-retry-button").click()
        try:
            await self.page.wait_for_function("() => document.querySelector('[data-testid=ask-error-card]') || document.querySelector('[data-testid=ask-handoff-status]')?.textContent === 'This issue stays attached to your follow-up questions.'", timeout=90_000)
        except PlaywrightTimeoutError as exc:
            raise BlockedScenario(f"File Gate showed {file_state}: {file_verdict}; recovery worked, but real Higgins did not finish within 90 seconds") from exc
        if await self.page.get_by_test_id("ask-error-card").count():
            raise self.higgins_failure(f"File Gate showed {file_state}: {file_verdict}; recovery worked. The user then saw: {await visible_text(self.page, 'ask-error')}")
        await self.page.wait_for_function("document.querySelector('[data-testid=ask-conversation-counts]')?.textContent === '1 question • 1 completed answer'", timeout=90_000)
        await self.page.get_by_test_id("ask-input").fill("Explain that more simply.")
        await self.page.get_by_test_id("ask-send-button").click()
        try:
            await self.page.wait_for_function("() => document.querySelector('[data-testid=ask-error-card]') || document.querySelector('[data-testid=ask-conversation-counts]')?.textContent === '2 questions • 2 completed answers'", timeout=90_000)
        except PlaywrightTimeoutError as exc:
            raise BlockedScenario(f"File Gate showed {file_state}: {file_verdict}; initial Higgins answer arrived, but the follow-up did not finish within 90 seconds") from exc
        if await self.page.get_by_test_id("ask-error-card").count():
            raise self.higgins_failure(f"File Gate showed {file_state}: {file_verdict}; the initial Higgins answer arrived. The user then saw on follow-up: {await visible_text(self.page, 'ask-error')}")
        raw_response = (await self.page.locator('[data-testid^="ask-message-h-"]').last.inner_text()).removesuffix("Hear Higgins").strip()
        quality = self.assert_higgins_meaning(raw_response, "file", f"{await visible_text(self.page, 'ask-active-gate')} {await visible_text(self.page, 'ask-active-summary')}")
        return f"Risky file source follow-up occurred after inspection; 'I already opened it' recovery worked; Higgins Retry and simpler follow-up preserved one conversation. Higgins quality: {quality}. Exact final Higgins response: {compact(raw_response, 1600)}"

    async def device(self) -> str:
        await self.open("/device")
        await self.page.get_by_test_id("device-status").wait_for(timeout=60_000)
        state = await visible_text(self.page, "device-state")
        summary = await visible_text(self.page, "device-summary")
        setting = self.page.locator('[data-testid^="device-open-"]').first
        if await setting.count():
            await setting.click()
            await self.page.get_by_test_id("device-settings-guidance").wait_for(timeout=30_000)
            await self.page.get_by_test_id("device-settings-guidance-close").click()
        await self.page.get_by_test_id("device-ask").click()
        try:
            await self.page.wait_for_function("() => document.querySelector('[data-testid=ask-error-card]') || document.querySelector('[data-testid=ask-handoff-status]')?.textContent === 'This issue stays attached to your follow-up questions.'", timeout=90_000)
        except PlaywrightTimeoutError as exc:
            raise BlockedScenario(f"Device Gate showed {state}: {summary}; Settings guidance opened, but real Higgins did not finish within 90 seconds") from exc
        if await self.page.get_by_test_id("ask-error-card").count():
            raise self.higgins_failure(f"Device Gate showed {state}: {summary}; Settings guidance opened. The user then saw: {await visible_text(self.page, 'ask-error')}")
        await self.page.get_by_test_id("ask-input").fill("Help me change that setting.")
        await self.page.get_by_test_id("ask-send-button").click()
        try:
            await self.page.wait_for_function("() => document.querySelector('[data-testid=ask-error-card]') || document.querySelector('[data-testid=ask-conversation-counts]')?.textContent === '2 questions • 2 completed answers'", timeout=90_000)
        except PlaywrightTimeoutError as exc:
            raise BlockedScenario(f"Device Gate showed {state}: {summary}; initial Higgins answer arrived, but the setting follow-up did not finish within 90 seconds") from exc
        if await self.page.get_by_test_id("ask-error-card").count():
            raise self.higgins_failure(f"Device Gate showed {state}: {summary}; the initial Higgins answer arrived. The user then saw on follow-up: {await visible_text(self.page, 'ask-error')}")
        raw_response = (await self.page.locator('[data-testid^="ask-message-h-"]').last.inner_text()).removesuffix("Hear Higgins").strip()
        quality = self.assert_higgins_meaning(raw_response, "device", f"{await visible_text(self.page, 'ask-active-gate')} {await visible_text(self.page, 'ask-active-summary')}")
        return f"State {state}; {summary}; Settings guidance and follow-up stayed attached to Device Gate context. Higgins quality: {quality}. Exact final Higgins response: {compact(raw_response, 1600)}"


def run_engine() -> dict:
    ENGINE_JSON.parent.mkdir(parents=True, exist_ok=True)
    command = ["node", "scripts/round1-scenario-engine.ts", "--out", str(ENGINE_JSON)]
    node_env = {**os.environ, "NODE_NO_WARNINGS": os.getenv("NODE_NO_WARNINGS", "1")}
    completed = subprocess.run(command, cwd=FRONTEND, check=False, text=True, env=node_env)
    if not ENGINE_JSON.exists():
        raise RuntimeError("Deterministic scenario engine did not create its report")
    data = json.loads(ENGINE_JSON.read_text())
    if completed.returncode and data.get("summary", {}).get("failed", 0) == 0:
        raise RuntimeError(f"Scenario engine exited {completed.returncode} without reported failures")
    return data


async def run_browser(base_url: str, mode: str, selected: set[str] | None = None) -> list[UiResult]:
    async with async_playwright() as playwright:
        browser_path = os.getenv("APOLLO_SCENARIO_BROWSER", "/root/bin/chromium")
        launch_options = {"headless": True}
        if Path(browser_path).exists():
            launch_options["executable_path"] = browser_path
        browser = await playwright.chromium.launch(**launch_options)
        context = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await context.new_page()
        page.set_default_timeout(30_000)
        runner = Round1Browser(page, base_url, mode)
        cases = [
            ("ui-site-popup", "site", "Ten-Gate overview and stopped-protection recommendation", "All ten Gates visible; popup dismisses before the working Device Gate action", runner.site),
            ("ui-link-threat", "link", "Threatening bank lookalike", "Barking result; persistent trusted verification; truthful continue label", runner.link),
            ("ui-text-threat", "text", "Verification-code request", "Barking result and persistent sender-check instructions", runner.text),
            ("ui-call-threat", "call", "Caller requests a security code", "Threatening call result and trusted callback guidance", runner.call),
            ("ui-network-ambiguous", "network", "Available preview network information", "Unknown limitations remain visible; no unsupported block claim", runner.network),
            ("ui-account-unknown-report", "account", "No alert evidence plus offline report", "Unknown stays unknown; no false report success; Retry; Mark as handled", runner.account),
            ("ui-email-threat", "email", "Bank-impersonation email", "Threat result and independently trusted verification instructions", runner.email),
            ("ui-app-remote", "app", "Remote-support app prompted by caller", "Capability risk plus working persistent Settings guidance", runner.app),
            ("ui-file-handoff", "file", "Disguised executable and post-open follow-up", "Evidence-first follow-up; recovery; automatic Higgins Retry and continuity", runner.file),
            ("ui-device-setting", "device", "Observed protection health and setting follow-up", "Visible limitation, working setting guidance and retained Higgins context", runner.device),
        ]
        for args in cases:
            if selected and args[0] not in selected:
                runner.results.append(UiResult(args[0], args[1], args[2], args[3], 'Not selected in this run.', 'NOT_RUN', evidence='none'))
                continue
            await runner.run(*args)
        await context.set_offline(False)
        await browser.close()
        return runner.results


def markdown(engine: dict, ui: list[UiResult], base_url: str, mode: str) -> str:
    lines = [
        "# Apollo Round 1 — expected versus actual",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Browser target: `{base_url}`",
        f"Execution mode: **{mode}**",
        "",
        "Expected outcomes are source-controlled in `frontend/scripts/round1-scenario-engine.ts` before execution. Local preflight, real downstream browser evidence and device-only work are deliberately separate. Local preflight is not investigation/Higgins acceptance.",
        "",
        "## Outcome summary",
        "",
        f"- Local application-logic preflight: **{engine['summary']['passed']}/{engine['summary']['total']} matched expectations** — not counted as external investigation or Higgins acceptance",
        f"- Browser journeys: **{sum(item.outcome == 'COMPLETE' for item in ui)}/{len(ui)} complete**, **{sum(item.outcome == 'PARTIAL' for item in ui)} partial**, **{sum(item.outcome == 'FAILED' for item in ui)} failed**, **{sum(item.outcome == 'BLOCKED' for item in ui)} blocked**, **{sum(item.outcome == 'NOT_RUN' for item in ui)} not run**",
        f"- Device-only scenarios: **{len(engine['device_only'])} blocked from browser completion and not counted as complete**",
        "- External-source handling: **configured real services in every mode; no verdict, finding or Higgins response is injected**",
        "",
        "## Local preflight across all ten Gates — not downstream acceptance",
        "",
        "| ID | Gate | Situation | Expected state / detection / action | Actual state / detection / action | Outcome |",
        "|---|---|---|---|---|---|",
    ]
    for item in engine["scenarios"]:
        expected = item["expected"]
        actual = item["actual"]
        lines.append(f"| `{item['id']}` | {item['gate']} | {item['tone']} | {expected['state']}; {compact(expected['detection'], 70)}; {compact(expected['action'], 90)}; must not: {compact(', '.join(expected['mustNot']), 80)} | {actual['state']}; {compact(actual['detection'], 70)}; {compact(actual['action'], 90)} | {'COMPLETE' if item['pass'] else 'FAILED'} |")
    lines += ["", "## Realistic multi-Gate situations", "", "| ID | Situation | Expected Gate path / meaning | Actual | Outcome |", "|---|---|---|---|---|"]
    for item in engine.get("multi_gate", []):
        lines.append(f"| `{item['id']}` | {item['situation']} | {compact(json.dumps(item['expected']), 190)} | {compact(json.dumps(item['actual']), 210)} | {'COMPLETE' if item['pass'] else 'FAILED'} |")
    lines += ["", "## Normal app journeys", "", "| ID | Gate | Situation | Expected | Actual | Outcome |", "|---|---|---|---|---|---|"]
    for item in ui:
        lines.append(f"| `{item.id}` | {item.gate} | {item.situation} | {compact(item.expected, 140)} | {compact(item.actual, 180)} | {item.outcome} |")
    lines += ["", "## Journey details — what the user actually saw", ""]
    for item in ui:
        lines += [f"### `{item.id}` — {item.outcome}", "", f"- **Expected:** {item.expected}", f"- **User saw:** {item.actual}", f"- **Cause/gap:** {item.cause or 'None observed in this run.'}", f"- **Artifact:** `{item.artifact}`", ""]
    lines += ["## Device-only scenarios — blocked from browser evidence", ""]
    for item in engine["device_only"]:
        lines.append(f"- `{item['id']}` ({item['gate']}) — **BLOCKED**: {item['reason']}")
    weakest = [item for item in ui if item.outcome != "COMPLETE" or "=no" in item.actual or "not available" in item.actual]
    lines += ["", "## Weakest outcomes", ""]
    if weakest:
        for item in weakest:
            lines.append(f"- `{item.id}` — **{item.outcome}**: {compact(item.actual, 500)}")
    else:
        lines.append("- No incomplete, failed or semantically weak Higgins outcomes were observed in this run.")
    lines += [
        "",
        "## Runtime mocks, templates and deterministic fallbacks",
        "",
        "- Web preview native device/network/app observations remain simulated or unavailable and are never treated as physical-device evidence.",
        "- The deterministic 35-scenario engine is expectation preflight only; it does not stand in for external investigation or a Higgins response.",
        "- No deterministic substitute Higgins investigation is accepted. Missing Gemini output is explicitly incomplete; supplied-evidence-only compatibility investigations are not full research acceptance.",
        "- Structured Higgins handoffs retry real Gemini once after a transport or grounding rejection. They do not substitute a canned answer; after both attempts fail, the user sees a Retry error and the journey is FAILED or BLOCKED.",
        "",
        "## Remaining capability gaps",
        "",
        "- **Bounded evidence handoff:** Ask Higgins currently carries at most 8 findings, 6 uncertainty items and 4 supported actions. Each item is length-bounded; longer investigations can still lose lower-priority evidence.",
        "- **Bounded investigation inputs:** Message/email text and isolated webpage excerpts are intentionally capped before Gemini processing. This protects privacy and latency but is not complete-document or complete-page analysis.",
        "- **Restricted research:** Live investigation uses configured reputation sources, official-brand guidance and an SSRF-protected page fetch. It has no unrestricted general web-research tool; DNS/SSRF/provider failures remain unresolved evidence rather than inferred verdicts.",
        "- **Provider/guard compatibility:** Real Gemini prose can still fail the unsupported-capability, uncertainty or action contract. Ask Higgins then shows a Retry error and does not silently replace the answer.",
        "- **Native scope:** Physical Stage 1D work remains cancelled. Native macOS/Windows enforcement adapters remain backlog, while current device-specific Settings guidance is still reviewed in browser where possible.",
        "",
        "## Interpretation rule",
        "",
        "A scenario passes only when the selected Gate is understandable, the detection preserves uncertainty, the investigation does not overclaim, Higgins provides a plain explanation, and the person can complete one labelled next action. Test count alone is not acceptance.",
    ]
    return "\n".join(lines) + "\n"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("APOLLO_SCENARIO_URL"))
    parser.add_argument("--mode", choices=("repeatable", "live"), default="repeatable")
    parser.add_argument("--scenario", action="append", help="Run only a named browser scenario; may be repeated. Deterministic catalogue still runs in full.")
    parser.add_argument("--skip-browser", action="store_true", help="Run deterministic scenarios only; browser journeys will be reported as skipped, not passed.")
    args = parser.parse_args()
    if not args.base_url and not args.skip_browser:
        parser.error('Set --base-url or APOLLO_SCENARIO_URL to this environment; no saved preview URL is assumed.')
    global ARTIFACTS
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8]
    run_dir = REPORT_DIR / 'round1_runs' / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    ARTIFACTS = run_dir / 'artifacts'
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    engine = run_engine()
    ui = [UiResult(f'not-run-{gate}', gate, 'Catalogue journey', 'Run the normal user journey.', 'Browser execution was skipped.', 'NOT_RUN', evidence='none')
          for gate in ('site', 'link', 'text', 'call', 'network', 'account', 'email', 'app', 'file', 'device')] if args.skip_browser else await run_browser(args.base_url, args.mode, set(args.scenario or []) or None)
    commit = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    source_paths = [Path(__file__), FRONTEND / 'scripts/round1-scenario-engine.ts']
    for directory in ('backend/core', 'backend/services', 'backend/routers', 'frontend/app', 'frontend/src'):
        source_paths.extend(path for path in (ROOT / directory).rglob('*') if path.suffix in ('.py', '.ts', '.tsx') and '__pycache__' not in path.parts)
    hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(set(source_paths))}
    payload = {"round": "Round 1", 'run_id': run_id, 'commit': commit, 'selected_scenarios': args.scenario or [],
               'source_hashes': hashes, 'working_tree_identity': 'source_hashes; commit is the Git base reference, not a claim that working files were committed',
               'ai_provider': 'Gemini only', 'provider_configuration_verified': False,
               'environment': {'base_url': args.base_url, 'physical_device_testing': 'CANCELLED'},
               "mode": args.mode, "generated_at": datetime.now(timezone.utc).isoformat(), "base_url": args.base_url, "engine": engine, "browser": [asdict(item) for item in ui]}
    json_path = run_dir / f"round1_expected_vs_actual_{args.mode}.json"
    md_path = run_dir / f"round1_expected_vs_actual_{args.mode}.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n")
    md_path.write_text(markdown(engine, ui, args.base_url, args.mode))
    (REPORT_DIR / 'round1_latest.json').write_text(json.dumps({'run_id': run_id, 'report': str(json_path.relative_to(ROOT))}, indent=2) + '\n')
    failed = engine["summary"]["failed"] + sum(item.outcome == "FAILED" for item in ui)
    incomplete = sum(item.outcome in ("PARTIAL", "BLOCKED", "NOT_RUN") for item in ui)
    print(f"Readable report: {md_path}")
    print(f"Machine report: {json_path}")
    return 1 if failed else 2 if incomplete else 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except PlaywrightTimeoutError as exc:
        print(f"Round 1 runner timed out before it could write a complete report: {exc}", file=sys.stderr)
        raise
