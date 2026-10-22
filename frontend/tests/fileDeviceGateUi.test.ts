import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const email = read("../app/email.tsx");
const file = read("../app/file.tsx");
const device = read("../app/device.tsx");
const app = read("../app/app-check.tsx");

test("Email Gate discloses the attachment-transfer limit before File Gate handoff", () => {
  // The old inline "preview disclaimer" card is gone: the screen now leads with the source hero, and
  // the preview marking lives inside the picker popup it opens (see SourceHero / simulation.tag).
  assert.match(email, /email-attachment-limitation/);
  assert.match(email, /file itself was not transferred/);
  assert.match(email, /pathname: "\/file", params: \{ source: "email" \}/);
});

test("File Gate preserves source context without treating cloud hosting as safety", () => {
  assert.match(file, /accessibilityState=\{\{ checked: source === o\.id && pending\.sourceAnswered \}\}/);
  assert.match(file, /Cloud hosting is not proof of safety/);
  assert.match(file, /file-higgins-explanation/);
  assert.ok(file.indexOf('testID="file-pick"') < file.indexOf('testID="file-source-followup"'));
  assert.match(file, /file-picker-retry/);
});

test("Device and App Gates explain capability limits and supported remediation", () => {
  assert.match(device, /device-protection-health/);
  assert.match(device, /device-higgins-recheck/);
  assert.match(device, /reports suspected tampering only when a specific high-confidence/);
  assert.match(app, /app-capability-evidence-note/);
  assert.match(app, /inactive or dormant app keeps those capabilities/);
  assert.match(app, /app-check-device/);
});