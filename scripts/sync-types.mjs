#!/usr/bin/env node
// Re-copy the vendored visualizer contract from a local checkout of the app.
//
// The plugin can't import the host's sources, so the contract is vendored. Hand-
// patching that copy is the failure mode worth designing against: nothing would
// error, and the drift would only surface as a misbehaving deck on a user's
// machine. So the copy is generated, and this is the only sanctioned way to
// update it.
//
// Dev-only. CI has no app checkout, and `minAppVersion` in manifest.json is what
// actually gates compatibility at install time.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appArg = process.argv[2];
const candidates = appArg
  ? [resolve(appArg)]
  : [
      resolve(root, "..", "viboplr"),
      resolve(root, "..", "viboplr", ".claude", "worktrees", "1"),
    ];

const rel = join("src", "types", "pluginVisualizer.ts");
const found = candidates.map((c) => join(c, rel)).find(existsSync);

if (!found) {
  console.error(
    "No app checkout found. Looked for:\n" +
      candidates.map((c) => `  ${join(c, rel)}`).join("\n") +
      "\n\nPass one explicitly:  npm run sync-types -- /path/to/viboplr",
  );
  process.exit(1);
}

const dst = join(root, "types", "viboplr-visualizer.d.ts");
const previous = existsSync(dst) ? readFileSync(dst, "utf8") : "";
const header = previous.slice(0, previous.indexOf("// The plugin"));
if (!header) {
  console.error(`Could not find the vendored header in ${dst} — refusing to clobber it.`);
  process.exit(1);
}

const next = header + readFileSync(found, "utf8");
if (next === previous) {
  console.log(`Already in sync with ${found}`);
} else {
  writeFileSync(dst, next);
  console.log(`Updated types/viboplr-visualizer.d.ts from ${found}`);
  console.log("Run `npm run verify` — a contract change may need code changes too.");
}
