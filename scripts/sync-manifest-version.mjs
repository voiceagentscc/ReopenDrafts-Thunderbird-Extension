// Keep the checked-in manifest.json version in lockstep with package.json.
//
// package.json is the single source of truth for the version. This script
// rewrites only the "version" field of manifest.json so the two never drift
// apart in a committed tree. It is used in two ways:
//
//   npm run sync-version        rewrite manifest.json to match package.json
//   npm run sync-version -- --check
//                             exit non-zero if manifest.json is out of sync
//                             (used by CI as a backstop when the git hook is
//                              bypassed); it never writes in check mode.
//
// The rewrite is idempotent: running it when the files already agree is a
// no-op, so it is safe to invoke unconditionally from a pre-commit hook.

import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const path = "manifest.json";
const text = readFileSync(path, "utf8");
const next = text.replace(/("version":\s*)"[^"]+"/, `$1"${version}"`);

if (process.argv.includes("--check")) {
  if (next !== text) {
    console.error(`manifest.json version is out of sync with package.json (${version}); run "npm run sync-version".`);
    process.exit(1);
  }
  console.log(`manifest.json version is in sync with package.json (${version}).`);
  process.exit(0);
}

if (next !== text) {
  writeFileSync(path, next);
  console.log(`Synced manifest.json version to ${version} (from package.json).`);
} else {
  console.log(`manifest.json version already in sync (${version}).`);
}
