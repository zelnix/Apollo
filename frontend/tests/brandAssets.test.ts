import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const app = JSON.parse(readFileSync(new URL("app.json", root), "utf8"));

function png(path: string) {
  const bytes = readFileSync(new URL(path, root));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25], size: bytes.length };
}

test("user-supplied Apollo artwork drives every app icon surface", () => {
  assert.equal(app.expo.icon, "./assets/images/icon.png");
  assert.equal(app.expo.android.adaptiveIcon.foregroundImage, "./assets/images/adaptive-icon.png");
  assert.equal(app.expo.web.favicon, "./assets/images/favicon.png");
  assert.deepEqual(png("assets/images/icon.png"), { width: 1024, height: 1024, colorType: 2, size: png("assets/images/icon.png").size });
  assert.deepEqual(png("assets/images/adaptive-icon.png").width, 1024);
  assert.equal(png("assets/images/adaptive-icon.png").colorType, 6);
  assert.deepEqual(png("assets/images/favicon.png").width, 64);
});

test("in-app Apollo logo is transparent and source artwork is preserved", () => {
  const logo = png("assets/images/logo.png");
  const source = png("assets/images/logo-source.png");
  assert.deepEqual([logo.width, logo.height, logo.colorType], [512, 512, 6]);
  assert.equal(source.width, source.height);
  assert.ok(source.width >= 1024);
  const component = readFileSync(new URL("src/components/ApolloLogo.tsx", root), "utf8");
  assert.match(component, /assets\/images\/logo\.png/);
});