// Higgins' face is drawn by one component everywhere: the same rounded square, left of the title it leads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("only HigginsAvatar loads Higgins' face", () => {
  const offenders = [...files(join(ROOT, "app")), ...files(join(ROOT, "src"))]
    .filter((path) => !path.endsWith("HigginsAvatar.tsx") && readFileSync(path, "utf8").includes("higgins-avatar.png"));
  assert.deepEqual(offenders, []);
});

test("the avatar is a rounded square, never a circle", () => {
  const source = readFileSync(join(ROOT, "src/components/HigginsAvatar.tsx"), "utf8");
  const corner = Number(source.match(/HIGGINS_AVATAR_CORNER = ([\d.]+)/)?.[1]);
  assert.ok(corner > 0 && corner < 0.5, "a corner of half the side would make it a circle");
});
