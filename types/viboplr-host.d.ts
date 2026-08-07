// The slice of the Viboplr plugin API this plugin actually uses.
//
// Deliberately a SUBSET, not a copy of the host's `ViboplrPluginAPI`. That type
// pulls in the whole library/playback/download surface and its entity types;
// vendoring all of it to type one call would be a large file that rots.
//
// It really is one call now. This file used to also carry narrowed `select` /
// `toggle` / `text` / `section` view-node types for the settings panel, plus
// `log` and `storage` for saving what the panel set. The deck has no settings, so
// none of that is reachable — and an unused vendored type is exactly the kind of
// thing that drifts from the host unnoticed. Add a member back here when the
// plugin starts making the call.
//
// The visualizer contract is the part that must NOT be trimmed — it is copied
// verbatim in viboplr-visualizer.d.ts.

import type { PluginVisualizer, PluginVisualizerDescriptor } from "./viboplr-visualizer";

export interface ViboplrHostApi {
  visualizers: {
    register(descriptor: PluginVisualizerDescriptor): () => void;
    unregister(id: string): void;
    /** Must return a FRESH instance per call — one per occupied slot. */
    onMount(id: string, factory: () => PluginVisualizer): () => void;
  };
}
