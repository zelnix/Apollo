import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("screenshot access is guided and rechecked after returning from Settings", () => {
  const hook = read("../src/hooks/useScreenshotAccess.ts");
  assert.match(hook, /getMediaLibraryPermissionsAsync/);
  assert.match(hook, /permission\.canAskAgain/);
  assert.match(hook, /Linking\.openSettings\(\)/);
  assert.match(hook, /AppState\.addEventListener\("change"/);
  assert.match(hook, /state !== "active"/);
  assert.match(hook, /if \(next\.granted\) await callback\.current\(\)/);
});

test("Text and Link screenshot controls use the shared guided access boundary", () => {
  const message = read("../app/message.tsx");
  const link = read("../app/check.tsx");
  for (const source of [message, link]) {
    assert.match(source, /useScreenshotAccess/);
    assert.match(source, /ScreenshotPermissionSheet/);
    assert.match(source, /photoAccess\.start\(\)/);
  }
});