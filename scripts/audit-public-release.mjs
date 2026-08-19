import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
const forbidden = [
  "worklog.md", "docs/release-practices.md", "docs/user-tasks.md", "bug-report.md",
  "Reopen-Drafts-Additional-Icon-Pack", "Reopen-Drafts-Icon-Pack", "Reopen-Drafts-Redrawn-16px-Icons",
];
const xpi = "dist/reopen-drafts.xpi";
assert.ok(existsSync(xpi), "build the XPI before auditing it");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageCommand = packageJson.scripts.package;
for (const name of forbidden) {
  assert.ok(!packageCommand.includes(name), `XPI package command includes internal file: ${name}`);
}
for (const family of ["beer", "window"]) {
  assert.ok(existsSync(`assets/icons/${family}`), `source tree is missing ${family} icon assets`);
}
assert.match(packageCommand, /LICENSE/);
assert.match(packageCommand, /NOTICE/);

console.log("Public release audit passed.");
