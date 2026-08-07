// Vinyl Deck — presses the live play queue onto a single-sided record.
//
// A visualizer plugin, and nothing else: it contributes the deck to the host's
// visualizer slots and owns no state at all. The host drives the frame loop and
// supplies live playback state; the deck's only writes are seek, play-queue-index
// and play/pause.
//
// There are no settings. The deck used to ship three — a crop, a platter tilt and
// a gap outline — plus a panel, storage and a live options object threaded down to
// every mounted instance so a running deck could pick a change up mid-frame. All
// of it is gone: none of the three answered a question a listener has, and two of
// them made the deck less like a record rather than more. What's left is the whole
// plugin.
//
// Built by vite into a single IIFE (see vite.config.ts), so the host's existing
// `new Function("api", code)` loader is unchanged — the build step is purely
// author-side.

import type { ViboplrHostApi } from "../types/viboplr-host";
import { createVinylDeckVisualizer } from "./visualizer";

export function activate(api: ViboplrHostApi) {
  // A fresh instance per occupied slot — the same deck may be in two at once
  // (Now Playing and fullscreen), and they must not share DOM.
  api.visualizers.onMount("deck", () => createVinylDeckVisualizer());
}

export function deactivate() {
  // The host drops the visualizer factory on unload and destroys any mounted
  // instance. Nothing else to release.
}
