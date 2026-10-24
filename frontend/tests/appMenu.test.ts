// Hamburger menu placement: one pop-up route list drives both the Stack's modal presentation and the menu.
// Run: node --test tests/appMenu.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { isPopupRoute, MODAL_ROUTES } from "../src/navigation/modalRoutes.ts";

test("pop-up routes hide the menu; full screens show it", () => {
  assert.equal(isPopupRoute(["support"]), true);
  assert.equal(isPopupRoute(["patrol", "[id]"]), true);
  assert.equal(isPopupRoute(["settings"]), true, "settings/index opened on its own is a pop-up");
  assert.equal(isPopupRoute(["(tabs)", "settings"]), false, "Settings as a tab is a full screen");
  assert.equal(isPopupRoute(["(tabs)", "patrol"]), false);
  assert.equal(isPopupRoute(["higgins", "learning", "[slug]"]), false);
  assert.equal(isPopupRoute(["patrol", "history"]), false);
});

test("the root Stack presents exactly the shared list as modals", () => {
  const layout = readFileSync("app/_layout.tsx", "utf8");
  assert.match(layout, /MODAL_ROUTES\.map\(\(name\) => <Stack\.Screen key=\{name\} name=\{name\} options=\{\{ presentation: "modal" \}\} \/>\)/);
  assert.doesNotMatch(layout, /name="[^"]+" options=\{\{ presentation: "modal" \}\}/, "no modal declared outside the shared list");
  assert.equal(new Set(MODAL_ROUTES).size, MODAL_ROUTES.length);
});

test("the menu is the last header icon on the main screens and shared headers", () => {
  const lastBefore = (file: string, closing: string) => {
    const src = readFileSync(file, "utf8");
    const at = src.indexOf("<AppMenuButton");
    assert.ok(at > 0, `${file} has the menu`);
    const after = src.slice(at, src.indexOf(closing, at));
    assert.doesNotMatch(after.replace(/<AppMenuButton[^>]*\/>/, ""), /<(AlertsButton|InfoButton|Pressable)/, `${file}: nothing after the menu`);
  };
  lastBefore("src/components/RootScreenHeader.tsx", "</View>");
  lastBefore("src/components/CheckToolHeader.tsx", "</View>");
  lastBefore("app/(tabs)/home.tsx", "</View>");
  lastBefore("app/(tabs)/patrol.tsx", "</View>");
  lastBefore("app/(tabs)/ask.tsx", "</View>");
  // Screens closed with an X are pop-ups: no menu.
  assert.doesNotMatch(readFileSync("src/components/ChildScreenHeader.tsx", "utf8"), /AppMenuButton/);
});

test("Threats and Scam Alerts lead their titles with a colourful icon", () => {
  assert.match(readFileSync("app/(tabs)/patrol.tsx", "utf8"), /<HeaderIconTile icon=\{ShieldAlert\} color=\{colors\.barking\}/);
  const scams = readFileSync("app/higgins/scams.tsx", "utf8");
  assert.match(scams, /<HeaderIconTile icon=\{Megaphone\} color=\{colors\.growling\}/);
  assert.equal((scams.match(/leading=\{titleIcon\}/g) ?? []).length, 2, "tab and stand-alone headers both show it");
});

test("header titles shrink to stay on one line instead of wrapping", async () => {
  const { fittedSize } = await import("../src/utils/fitTitle.ts");
  assert.equal(fittedSize("Threats", 0, 28, 20), 28, "before layout: full size");
  assert.equal(fittedSize("Scam Alerts", 200, 28, 20), 28, "room to spare: full size");
  assert.equal(fittedSize("Ask Higgins", 134, 28, 20), 24, "tight header: steps down");
  assert.equal(fittedSize("Learn with Higgins", 60, 28, 20), 20, "never below the minimum");
});
