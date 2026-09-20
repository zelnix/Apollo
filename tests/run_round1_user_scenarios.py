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
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable
from urllib.parse import urlparse

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


def compact(value: str, limit: int = 260) -> str:
    return " ".join(value.split())[:limit]


async def visible_text(page: Page, test_id: str) -> str:
    locator = page.get_by_test_id(test_id)
    if await locator.count() == 0:
        return ""
    return compact(await locator.first.inner_text())


class Round1Browser:
    def __init__(self, page: Page, base_url: str, mode: str, control: dict[str, bool]):
        self.page = page
        self.base = base_url.rstrip("/")
        self.mode = mode
        self.control = control
        self.results: list[UiResult] = []

    def assert_higgins_meaning(self, response: str, gate: str) -> None:
        lower = response.lower()
        assert gate in lower, f"Higgins response lost the selected {gate} Gate context"
        assert "unknown" in lower or "uncertain" in lower or "cannot" in lower, "Higgins did not preserve uncertainty"
        assert "next action" in lower, "Higgins did not provide one explicit next action"
        assert "i blocked" not in lower, "Higgins made an unsupported first-person enforcement claim"
        assert "safe to open" not in lower and "verified safe" not in lower, "Higgins made an unsupported safety claim"

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

    async def run(self, scenario_id: str, gate: str, situation: str, expected: str, body: Callable[[], Awaitable[str]]) -> None:
        try:
            actual = await body()
            artifact = ARTIFACTS / self.mode / f"{scenario_id}.png"
            artifact.parent.mkdir(parents=True, exist_ok=True)
            await self.page.screenshot(path=str(artifact), full_page=False)
            self.results.append(UiResult(scenario_id, gate, situation, expected, actual, "PASS", artifact=str(artifact)))
            print(f"PASS {scenario_id}: {actual}")
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
            self.results.append(UiResult(scenario_id, gate, situation, expected, compact(message), "FAIL", artifact=str(artifact) if artifact else None))
            print(f"FAIL {scenario_id}: {message}")

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
        await self.page.get_by_test_id("check-submit-button").click()
        await self.page.get_by_test_id("check-result-card").wait_for(timeout=90_000)
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
        return f"Threat state {state}; {verdict}; persistent verification instructions opened. Ambiguous shortened-link override label is truthful."

    async def text(self) -> str:
        await self.open("/text-guard")
        await self.page.get_by_test_id("textguard-sender").fill("Bank Security")
        await self.page.get_by_test_id("textguard-text").fill("Your account is locked. Read me the verification code now.")
        await self.page.get_by_test_id("textguard-check").click()
        await self.wait_for_any(("textguard-result", "message-assessment"))
        state = await visible_text(self.page, "textguard-state") or await visible_text(self.page, "message-assessment-risk-label")
        verdict = await visible_text(self.page, "textguard-verdict") or await visible_text(self.page, "message-assessment-headline")
        await self.page.get_by_test_id("textguard-verify-sender").click()
        await self.page.get_by_test_id("textguard-verify-sheet").wait_for()
        return f"State {state}; {verdict}; sender-check instructions remained visible."

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
        root = await self.page.locator("#root").inner_text()
        assert "Login prompt you didn't start" not in root
        if self.mode == "repeatable":
            self.control["fail_next_feedback"] = True
        else:
            await self.page.context.set_offline(True)
        await self.page.get_by_test_id("account-report").click()
        await self.page.get_by_test_id("account-report-error").wait_for(timeout=30_000)
        assert await self.page.get_by_text("Retry report", exact=True).is_visible()
        await self.page.context.set_offline(False)
        await self.page.get_by_test_id("account-report").click()
        await self.page.get_by_test_id("account-report-success").wait_for(timeout=60_000)
        resolve = self.page.get_by_test_id("account-resolve")
        assert await resolve.inner_text() == "Mark as handled"
        return "No-evidence path stayed unknown; offline report showed Retry; online retry succeeded; resolution label is Mark as handled."

    async def email(self) -> str:
        await self.open("/email")
        await self.page.get_by_test_id("email-from").fill("CommBank <alerts@cb-secure.top>")
        await self.page.get_by_test_id("email-subject").fill("Urgent account lock")
        await self.page.get_by_test_id("email-body").fill("Verify now https://commbank-secure-verify.xyz/login")
        await self.page.get_by_test_id("email-run").click()
        await self.wait_for_any(("email-result", "email-assessment"))
        state = await visible_text(self.page, "email-state") or await visible_text(self.page, "email-assessment-risk-label")
        verdict = await visible_text(self.page, "email-verdict") or await visible_text(self.page, "email-assessment-headline")
        await self.page.get_by_test_id("email-verify-sender").click()
        await self.page.get_by_test_id("email-verify-sheet").wait_for()
        return f"State {state}; {verdict}; sender verification remained persistent and did not open suspicious content."

    async def app(self) -> str:
        await self.open("/app-check")
        await self.page.get_by_test_id("app-name").fill("Quick Support")
        for test_id in ("app-source-message", "app-purpose-remote_support", "app-perm-accessibility", "app-perm-screen_share", "app-ctx-caller", "app-ctx-access"):
            locator = self.page.get_by_test_id(test_id)
            if await locator.count():
                await locator.click()
        await self.page.get_by_test_id("app-run").click()
        await self.wait_for_any(("app-result", "app-assessment"))
        state = await visible_text(self.page, "app-state") or await visible_text(self.page, "app-assessment-risk-label")
        verdict = await visible_text(self.page, "app-verdict") or await visible_text(self.page, "app-assessment-headline")
        settings = self.page.get_by_test_id("app-open-settings")
        if await settings.count():
            await settings.click()
            await self.page.get_by_test_id("app-action-guidance").wait_for(timeout=30_000)
        return f"State {state}; {verdict}; Settings action produced persistent guidance in browser."

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
        await self.page.get_by_test_id("file-recovery-open").click()
        await self.page.get_by_test_id("file-recovery-pick-clicked").click()
        await self.page.get_by_test_id("file-recovery-sheet").wait_for()
        await self.page.get_by_test_id("file-recovery-close").click()
        if self.mode == "repeatable":
            self.control["fail_next_ask"] = True
        else:
            await self.page.context.set_offline(True)
        await self.page.get_by_test_id("file-tell-more").click()
        await self.page.get_by_test_id("ask-error-card").wait_for(timeout=30_000)
        assert await self.page.get_by_test_id("ask-conversation-counts").inner_text() == "1 question • 0 completed answers"
        await self.page.context.set_offline(False)
        await self.page.get_by_test_id("ask-retry-button").click()
        await self.page.get_by_text("This issue stays attached to your follow-up questions.", exact=True).wait_for(timeout=90_000)
        await self.page.wait_for_function("document.querySelector('[data-testid=ask-conversation-counts]')?.textContent === '1 question • 1 completed answer'", timeout=90_000)
        await self.page.get_by_test_id("ask-input").fill("Explain that more simply.")
        await self.page.get_by_test_id("ask-send-button").click()
        await self.page.wait_for_function("document.querySelector('[data-testid=ask-conversation-counts]')?.textContent === '2 questions • 2 completed answers'", timeout=90_000)
        response = compact(await self.page.locator('[data-testid^="ask-message-h-"]').last.inner_text(), 500).removesuffix(" Hear Higgins")
        self.assert_higgins_meaning(response, "file")
        return f"Risky file source follow-up occurred after inspection; 'I already opened it' recovery worked; Higgins Retry and simpler follow-up preserved one conversation. Exact final Higgins response: {response}"

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
        await self.page.get_by_text("This issue stays attached to your follow-up questions.", exact=True).wait_for(timeout=90_000)
        await self.page.get_by_test_id("ask-input").fill("Help me change that setting.")
        await self.page.get_by_test_id("ask-send-button").click()
        await self.page.wait_for_function("document.querySelector('[data-testid=ask-conversation-counts]')?.textContent === '2 questions • 2 completed answers'", timeout=90_000)
        response = compact(await self.page.locator('[data-testid^="ask-message-h-"]').last.inner_text(), 500).removesuffix(" Hear Higgins")
        self.assert_higgins_meaning(response, "device")
        return f"State {state}; {summary}; Settings guidance and follow-up stayed attached to Device Gate context. Exact final Higgins response: {response}"


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
        control = {"fail_next_ask": False, "fail_next_feedback": False}
        controlled_endpoints = {"/api/intel/check", "/api/link/investigate", "/api/message/analyse", "/api/account/analyse", "/api/app/analyse", "/api/page/crawl", "/api/page/extract", "/api/account/breach", "/api/call/risk-check"}
        if mode == "repeatable":
            async def controlled_route(route):
                path = urlparse(route.request.url).path
                if path == "/api/feedback" and control["fail_next_feedback"]:
                    control["fail_next_feedback"] = False
                    await route.abort("connectionfailed")
                    return
                if path == "/api/ask/stream":
                    if control["fail_next_ask"]:
                        control["fail_next_ask"] = False
                        await route.abort("connectionfailed")
                        return
                    body = route.request.post_data_json or {}
                    issue = (body.get("context") or {}).get("issue_summary", "the selected issue")
                    gate = (body.get("context") or {}).get("gate", "security")
                    question = body.get("message", "What should I do?")
                    response = f"CONTROLLED RESPONSE — Higgins explains the {gate} finding for {issue}. The evidence is limited to what Apollo submitted, so safety and compromise remain unknown. Question: {question} Next action: use the one trusted action shown on the result screen."
                    stream = f"data: {json.dumps({'delta': response})}\n\ndata: {json.dumps({'done': True})}\n\n"
                    await route.fulfill(status=200, content_type="text/event-stream", body=stream, headers={"Cache-Control": "no-cache"})
                    return
                if path in controlled_endpoints:
                    await route.fulfill(status=503, content_type="application/json", body=json.dumps({"detail": "CONTROLLED_EXTERNAL_UNAVAILABLE", "mode": "repeatable"}))
                    return
                await route.continue_()
            await page.route("**/api/**", controlled_route)
        runner = Round1Browser(page, base_url, mode, control)
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
        "Expected outcomes are source-controlled in `frontend/scripts/round1-scenario-engine.ts` before execution. Automated engine evidence, browser evidence and device-only work are deliberately separate.",
        "",
        "## Outcome summary",
        "",
        f"- Deterministic situations: **{engine['summary']['passed']}/{engine['summary']['total']} passed**",
        f"- Browser journeys: **{sum(item.outcome == 'PASS' for item in ui)}/{len(ui)} passed**",
        f"- Device-only scenarios: **{len(engine['device_only'])} pending and not counted as browser completions**",
        f"- External-source handling: **{'controlled 503 fixtures plus controlled Higgins SSE; never live' if mode == 'repeatable' else 'configured live services; individual unavailability is reported in actual UI outcomes'}**",
        "",
        "## All ten Gates: threatening, legitimate and ambiguous situations",
        "",
        "| ID | Gate | Situation | Expected state / detection / action | Actual state / detection / action | Outcome |",
        "|---|---|---|---|---|---|",
    ]
    for item in engine["scenarios"]:
        expected = item["expected"]
        actual = item["actual"]
        lines.append(f"| `{item['id']}` | {item['gate']} | {item['tone']} | {expected['state']}; {compact(expected['detection'], 70)}; {compact(expected['action'], 90)}; must not: {compact(', '.join(expected['mustNot']), 80)} | {actual['state']}; {compact(actual['detection'], 70)}; {compact(actual['action'], 90)} | {'PASS' if item['pass'] else 'FAIL'} |")
    lines += ["", "## Realistic multi-Gate situations", "", "| ID | Situation | Expected Gate path / meaning | Actual | Outcome |", "|---|---|---|---|---|"]
    for item in engine.get("multi_gate", []):
        lines.append(f"| `{item['id']}` | {item['situation']} | {compact(json.dumps(item['expected']), 190)} | {compact(json.dumps(item['actual']), 210)} | {'PASS' if item['pass'] else 'FAIL'} |")
    lines += ["", "## Normal app journeys", "", "| ID | Gate | Situation | Expected | Actual | Outcome |", "|---|---|---|---|---|---|"]
    for item in ui:
        lines.append(f"| `{item.id}` | {item.gate} | {item.situation} | {compact(item.expected, 140)} | {compact(item.actual, 180)} | {item.outcome} |")
    lines += ["", "## Device-only scenarios — not completed by browser evidence", ""]
    for item in engine["device_only"]:
        lines.append(f"- `{item['id']}` ({item['gate']}): {item['reason']}")
    lines += [
        "",
        "## Interpretation rule",
        "",
        "A scenario passes only when the selected Gate is understandable, the detection preserves uncertainty, the investigation does not overclaim, Higgins provides a plain explanation, and the person can complete one labelled next action. Test count alone is not acceptance.",
    ]
    return "\n".join(lines) + "\n"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("APOLLO_SCENARIO_URL", "https://device-file-gate.preview.emergentagent.com"))
    parser.add_argument("--mode", choices=("repeatable", "live"), default="repeatable")
    parser.add_argument("--scenario", action="append", help="Run only a named browser scenario; may be repeated. Deterministic catalogue still runs in full.")
    parser.add_argument("--skip-browser", action="store_true", help="Run deterministic scenarios only; browser journeys will be reported as skipped, not passed.")
    args = parser.parse_args()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    engine = run_engine()
    ui = [] if args.skip_browser else await run_browser(args.base_url, args.mode, set(args.scenario or []) or None)
    payload = {"round": "Round 1", "mode": args.mode, "generated_at": datetime.now(timezone.utc).isoformat(), "base_url": args.base_url, "engine": engine, "browser": [asdict(item) for item in ui]}
    json_path = REPORT_DIR / f"round1_expected_vs_actual_{args.mode}.json"
    md_path = REPORT_DIR / f"round1_expected_vs_actual_{args.mode}.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n")
    md_path.write_text(markdown(engine, ui, args.base_url, args.mode))
    failed = engine["summary"]["failed"] + sum(item.outcome != "PASS" for item in ui)
    print(f"Readable report: {md_path}")
    print(f"Machine report: {json_path}")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except PlaywrightTimeoutError as exc:
        print(f"Round 1 runner timed out before it could write a complete report: {exc}", file=sys.stderr)
        raise
