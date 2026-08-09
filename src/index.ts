// Vinyl Deck — presses the live play queue onto a single-sided record.
//
// A visualizer plugin, and nothing else: it contributes the deck to the host's
// visualizer slots and owns no state at all. The host drives the frame loop and
// supplies live playback state; the deck's only writes are seek, play-queue-index
// and play/pause.
//
// THE SETTINGS PANEL IS BACK, for one reason, and the reason matters because the
// old one was deleted on purpose. The deck used to ship three options — a crop, a
// platter tilt and a gap outline — plus a panel, storage and a live options
// object threaded into every mounted instance. All three were cosmetic, none
// answered a question a listener has, and two made the deck less like a record.
//
// Sounds are not that. There are eleven of them, they are independent, and they
// are the first thing here a user might actively not want playing over their
// music — which is a preference, not a look. They also cannot be expressed the
// way the two LIVERIES below are: each livery is contributed as its own
// visualizer, so choosing between them happens in the host's picker, and a
// picker offers one choice from a list. "The needle drop but not the motor" is
// not a thing you can pick.
//
// So the machinery comes back at its narrowest — see soundSettings.ts, which is
// one value, one set of live instances and a broadcast, and nothing else.
//
// Built by vite into a single IIFE (see vite.config.ts), so the host's existing
// `new Function("api", code)` loader is unchanged — the build step is purely
// author-side.

import type { ViboplrHostApi } from "../types/viboplr-host";
import { installSoundPanel } from "./settingsPanel";
import { createVinylDeckVisualizer } from "./visualizer";

export function activate(api: ViboplrHostApi) {
  // A fresh instance per occupied slot — the same deck may be in two at once
  // (Now Playing and fullscreen), and they must not share DOM.
  api.visualizers.onMount("deck", () => createVinylDeckVisualizer("studio"));
  api.visualizers.onMount("sl1200", () => createVinylDeckVisualizer("sl1200"));
  installSoundPanel(api);
}

export function deactivate() {
  // The host drops the visualizer factory on unload and destroys any mounted
  // instance. Nothing else to release.
}
