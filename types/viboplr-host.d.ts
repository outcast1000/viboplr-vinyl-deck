// The slice of the Viboplr plugin API this plugin actually uses.
//
// Deliberately a SUBSET, not a copy of the host's `ViboplrPluginAPI`. That type
// pulls in the whole library/playback/download surface and its entity types;
// vendoring all of it to type one call would be a large file that rots.
//
// It was one call for a while. The narrowed view-node types and `storage` came
// back with the deck's sounds — eleven independent noises can't be expressed as
// a choice in the visualizer picker the way the two liveries are, so there is a
// panel again. Everything below is reachable; an unused vendored type is exactly
// the kind of thing that drifts from the host unnoticed, so nothing goes in here
// speculatively.
//
// The visualizer contract is the part that must NOT be trimmed — it is copied
// verbatim in viboplr-visualizer.d.ts.

import type { PluginVisualizer, PluginVisualizerDescriptor } from "./viboplr-visualizer";

/**
 * The narrow slice of the host's `PluginViewData` union this panel builds.
 *
 * Every member here must exist in the host's union verbatim. The host SKIPS a
 * node type it does not recognise — no error, no warning, nothing in the log —
 * so an invented one renders as a hole in the panel and looks like a layout bug.
 * A `vstack` wrapper was invented once and cost exactly that.
 */
export type HostViewNode =
  | { type: "section"; title: string; children: HostViewNode[] }
  | { type: "text"; text: string; variant?: string }
  | { type: "toggle"; label: string; description?: string; action: string; checked: boolean }
  | { type: "settings-row"; label: string; description?: string; control?: HostViewNode };

export interface ViboplrHostApi {
  visualizers: {
    register(descriptor: PluginVisualizerDescriptor): () => void;
    unregister(id: string): void;
    /** Must return a FRESH instance per call — one per occupied slot. */
    onMount(id: string, factory: () => PluginVisualizer): () => void;
  };
  ui: {
    setViewData(viewId: string, data: HostViewNode): void;
    onAction(actionId: string, handler: (data: unknown) => void): void;
  };
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
}
