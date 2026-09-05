// Gate 6 scenario benchmark (F01–F20). Run: yarn test:gate6
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyseFile, realTypeFromBytes, type FileSource } from "../src/domain/fileAnalysis.ts";

const MZ = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const run = (name: string, source: FileSource = "unknown", extra: Partial<Parameters<typeof analyseFile>[0]> = {}) => analyseFile({ name, source, ...extra });

test("F01 / acceptance 1: Statement.pdf.exe from unknown → barking, 'not really a PDF'", () => { const r = run("Statement.pdf.exe", "message", { headBytes: MZ }); assert.equal(r.state, "barking"); assert.equal(r.scenario, "F01"); assert.match(r.verdict, /not really a PDF/i); });
test("F01b PDF name but MZ bytes → barking (trust bytes, not name)", () => { const r = run("Invoice.pdf", "email", { headBytes: MZ }); assert.equal(r.state, "barking"); assert.equal(r.realType, "exe"); });
test("F14 RTL override trick → barking", () => { assert.equal(run("photo\u202eexe.jpg", "message", { headBytes: MZ }).state, "barking"); });
test("F10 / acceptance 2: MeetingAgenda.pdf from known sender → resting, humble wording", () => { const r = run("MeetingAgenda.pdf", "known", { headBytes: PDF, textSample: "Agenda 1. Welcome 2. Budget" }); assert.equal(r.state, "resting"); assert.match(r.verdict, /didn't find any obvious signs/); assert.ok(!/100%/.test(r.verdict)); });
test("F02 APK from website → growling/barking + app handoff", () => { const r = run("game.apk", "browser", { headBytes: ZIP }); assert.ok(["growling", "barking"].includes(r.state)); assert.equal(r.realType, "apk"); assert.equal(r.handoff, "app"); });
test("F20 fake WhatsApp update APK → barking", () => { const r = run("WhatsApp_update.apk", "message"); assert.equal(r.state, "barking"); assert.match(r.verdict, /never update through a file/i); });
test("F03 archive from unknown → growling; from known → ears_up", () => { assert.equal(run("docs.zip", "message", { headBytes: ZIP }).state, "growling"); assert.equal(run("docs.zip", "known", { headBytes: ZIP }).state, "ears_up"); });
test("F04 password-protected archive → ears_up (not automatically malicious)", () => { const r = run("files.rar", "email", { passwordInMessage: true }); assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "F04"); });
test("F05 invoice PDF with payment link → ears_up + web handoff + link extracted", () => { const r = run("Invoice_overdue.pdf", "email", { headBytes: PDF, textSample: "Pay now at https://pay-invoice-now.top/abc before Friday" }); assert.equal(r.state, "ears_up"); assert.equal(r.handoff, "web"); assert.deepEqual(r.urls, ["https://pay-invoice-now.top/abc"]); });
test("F08 macro document → ears_up/growling", () => { assert.ok(["ears_up", "growling"].includes(run("report.xlsm", "email", { headBytes: ZIP }).state)); });
test("F11 configuration profile → barking", () => { const r = run("wifi-setup.mobileconfig", "message"); assert.equal(r.state, "barking"); assert.match(r.verdict, /managed|network/i); assert.equal(r.handoff, "network"); });
test("F12 certificate → barking", () => { assert.equal(run("root.cer", "browser").state, "barking"); });
test("F13 script download → growling/barking", () => { assert.ok(["growling", "barking"].includes(run("setup.js", "browser").state)); });
test("F16 / acceptance 5: unknown extension → ears_up, no bark", () => { const r = run("data.qzx", "email"); assert.equal(r.state, "ears_up"); assert.match(r.verdict, /don't know this file type/i); });
test("F19 nearby share ordinary image → ears_up (preview first)", () => { assert.equal(run("IMG_2201.jpg", "nearby").state, "ears_up"); });
test("docx zip signature is office, not archive", () => { assert.equal(run("letter.docx", "known", { headBytes: ZIP }).realType, "office"); });
test("magic bytes", () => { assert.equal(realTypeFromBytes(PDF), "pdf"); assert.equal(realTypeFromBytes(MZ), "exe"); assert.equal(realTypeFromBytes(null, "application/pdf"), "pdf"); });
