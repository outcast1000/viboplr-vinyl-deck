// The slice of the Viboplr plugin API this plugin actually uses.
//
// Deliberately a SUBSET, not a copy of the host's `ViboplrPluginAPI`. That type
// pulls in the whole library/playback/download surface and its entity types;
// vendoring all of it to type five calls would be a large file that rots.
//
// The view-node shapes below are narrowed the same way — only the kinds this
// plugin emits. Keep them: type-checking the settings panel is what caught three
// malformed nodes that the earlier hand-written JS version shipped silently. Add
// a kind here when the plugin starts emitting it.
//
// The visualizer contract is the part that must NOT be trimmed — it is copied
// verbatim in viboplr-visualizer.d.ts.

import type { PluginVisualizer, PluginVisualizerDescriptor } from "./viboplr-visualizer";

/** A `select` control. Carries its own label + description. */
export interface HostSelectNode {
  type: "select";
  label: string;
  description?: string;
  action: string;
  value: string;
  options: { value: string; label: string }[];
}

/** A boolean control. Note `checked`, not `value` — a historical host quirk. */
export interface HostToggleNode {
  type: "toggle";
  label: string;
  description?: string;
  action: string;
  checked: boolean;
  disabled?: boolean;
}

export interface HostTextNode {
  type: "text";
  content: string;
  className?: string;
}

export interface HostSectionNode {
  type: "section";
  title: string;
  children: (HostSelectNode | HostToggleNode | HostTextNode)[];
}

export type HostViewData = HostSectionNode;

export interface ViboplrHostApi {
  /** Writes to the app's log stream. Levels: "info" | "warn" | "error". */
  log(level: string, message: string, section?: string): void;

  storage: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };

  ui: {
    setViewData(viewId: string, data: HostViewData, opts?: { scrollKey?: string }): void;
    /** Handles clicks/changes from controls this plugin rendered. */
    onAction(actionId: string, handler: (data: unknown) => void): void;
  };

  visualizers: {
    register(descriptor: PluginVisualizerDescriptor): () => void;
    unregister(id: string): void;
    /** Must return a FRESH instance per call — one per occupied slot. */
    onMount(id: string, factory: () => PluginVisualizer): () => void;
  };
}
