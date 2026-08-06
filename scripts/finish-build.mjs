#!/usr/bin/env node
// Move the single vite artifact into place and drop dist/.
//
// Vite won't emit into its own root, and the host reads ./index.js, so the build
// lands in dist/ and this puts it where it belongs. Also asserts the bundle has
// the shape the loader needs — a body that RETURNS the module — because a silent
// shape change here would produce a plugin that loads and does nothing.

import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "dist", "index.js");
const to = join(root, "index.js");

if (!existsSync(from)) {
  console.error(`Expected a bundle at ${from} — did vite build run?`);
  process.exit(1);
}

const code = readFileSync(from, "utf8");
if (!/return\s+__viboplrPlugin;?\s*$/.test(code.trimEnd())) {
  console.error(
    "Bundle does not end in `return __viboplrPlugin;`.\n" +
      "The host evaluates plugin code as a function body and uses its return value,\n" +
      "so without that footer the plugin loads and silently exports nothing.\n" +
      "Check rollupOptions.output.footer in vite.config.ts.",
  );
  process.exit(1);
}
if (!/exports\.activate\s*=/.test(code)) {
  console.error("Bundle never assigns exports.activate — the host would never activate it.");
  process.exit(1);
}

renameSync(from, to);
rmSync(join(root, "dist"), { recursive: true, force: true });
console.log(`index.js written (${(code.length / 1024).toFixed(1)} kB), shape verified`);
