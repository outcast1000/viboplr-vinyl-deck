#!/usr/bin/env bash
# Build vinyl-deck.zip (manifest.json at ROOT — required by install_plugin_from_zip)
# and update.json. Run from the repo root: scripts/package.sh
#
# Unlike the hand-written plugins, index.js here is a BUILD ARTIFACT. Run
# `npm run build` first (or use `npm run package`, which does build + test + this).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -e 'console.log(require("./manifest.json").version)')
MIN_APP=$(node -e 'console.log(require("./manifest.json").minAppVersion || "")')
FILE_URL="https://github.com/outcast1000/viboplr-vinyl-deck/releases/latest/download/vinyl-deck.zip"

if [ ! -f index.js ]; then
  echo "error: index.js is missing. It is generated — run 'npm run build' first." >&2
  exit 1
fi

# Changelog: lines under the top-most "## " heading in CHANGELOG.md, if present.
#
# The cap is `awk NR<=50`, NOT `head -50`. `head` closes the pipe the moment it
# has its 50 lines, which hands `sed` a SIGPIPE — and under `set -o pipefail`
# that kills the whole script with exit 4. It only bites once the top section is
# longer than the cap, so it sat here harmlessly through every release whose
# changelog happened to be shorter and then failed the first one that wasn't.
# awk reads to EOF and closes nothing early.
CHANGELOG=""
if [ -f CHANGELOG.md ]; then
  CHANGELOG=$(awk '/^## /{if(seen)exit; seen=1; next} seen{print}' CHANGELOG.md | sed '/^$/d' | awk 'NR<=50')
fi

rm -f vinyl-deck.zip
zip -q vinyl-deck.zip manifest.json index.js
echo "--- zip contents (manifest.json must have no dir prefix) ---"
unzip -l vinyl-deck.zip

VERSION="$VERSION" MIN_APP="$MIN_APP" FILE_URL="$FILE_URL" CHANGELOG="$CHANGELOG" node -e '
const fs=require("fs");
const info={version:process.env.VERSION, file:process.env.FILE_URL};
if(process.env.MIN_APP) info.minAppVersion=process.env.MIN_APP;
if(process.env.CHANGELOG) info.changelog=process.env.CHANGELOG;
fs.writeFileSync("update.json", JSON.stringify(info,null,2)+"\n");
console.log("wrote update.json:", JSON.stringify(info));
'

echo
echo "To publish: push the tag and let CI do it —"
echo "  git tag v${VERSION} && git push origin v${VERSION}"
echo
echo "Do NOT run 'gh release create' by hand. The Release workflow publishes on"
echo "the tag, so publishing locally creates the release first and CI's own"
echo "'gh release create' then dies with 'a release with the same tag name"
echo "already exists' — a red X on a release that is actually fine, which is"
echo "indistinguishable from a real failure. Let CI be the only publisher."
echo "(The zip + update.json built above are for local inspection; the workflow"
echo "rebuilds both from source.)"
