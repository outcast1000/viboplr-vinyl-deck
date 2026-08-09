// The sound switches, as a host settings panel.
//
// One toggle per voice plus a master, built from the VOICES table so a noise
// added later gets a switch by existing rather than by someone remembering.
//
// There is no level slider here. The host contract has no slider node, and the
// app's own volume already governs this — the visualizer audio bus tracks it, so
// a second gain in a panel would be a second volume control for the same sound.

import { VOICES, type DeckSoundSettings, type VoiceId } from "./sounds";
import { deckSoundSettings, setDeckSoundSettings } from "./soundSettings";
import type { HostViewNode, ViboplrHostApi } from "../types/viboplr-host";

export const PANEL_ID = "vinyl-deck-sounds";
const STORAGE_KEY = "sounds";

/** `toggle` actions are addressed by id, so each voice needs its own. */
export function voiceActionId(id: VoiceId): string {
  return `voice:${id}`;
}

export const MASTER_ACTION = "sounds:enabled";

/**
 * The new state carried by a toggle action.
 *
 * The host sends `{ value: !checked }`, NOT a bare boolean — see `PluginToggle`
 * in the app's pluginViews. Reading it as a boolean is silently always false, so
 * every toggle writes "off" and the switch springs back with nothing logged
 * anywhere. That cost a live test to find, which is why it is a named function
 * with this comment on it rather than an inline comparison.
 */
export function toggleValue(data: unknown): boolean {
  return (data as { value?: unknown } | null)?.value === true;
}

/**
 * The panel, as view nodes.
 *
 * Pure so it can be asserted without a host: this is the only place the switches
 * are named, and a toggle wired to the wrong action id looks identical in a
 * screenshot to one that works.
 */
export function buildSoundPanel(s: DeckSoundSettings): HostViewNode {
  const master: HostViewNode = {
    type: "toggle",
    label: "Deck sounds",
    description:
      "The turntable's own noises — the motor, the needle, the switches. They play over your music, at your app volume.",
    action: MASTER_ACTION,
    checked: s.enabled,
  };

  // Shown but inert when the master is off. Hiding them would make the panel
  // jump around as it is switched, and hide the fact that the choices persist.
  const voices: HostViewNode[] = VOICES.map((v) => ({
    type: "toggle",
    label: v.label,
    description: v.hint,
    action: voiceActionId(v.id),
    checked: s.enabled && s.voices[v.id] !== false,
  }));

  // Flat children. There is no stack/group node in the host's union — an earlier
  // draft wrapped the voices in one and the host rendered NOTHING for it, with no
  // error anywhere: an unknown node type is simply skipped. That is the failure
  // mode the vendored types exist to prevent, so `HostViewNode` now lists only
  // what the host really has.
  return {
    type: "section",
    title: "Sounds",
    children: [master, ...voices],
  };
}

/**
 * Wire the panel to the host and to storage.
 *
 * Storage is read once at activate and written on every change. The settings are
 * a handful of booleans, so there is nothing to debounce and no reason for the
 * panel to be the thing that owns them — `soundSettings.ts` is, and this only
 * translates between it and the host.
 */
export function installSoundPanel(api: ViboplrHostApi) {
  const render = () => api.ui.setViewData(PANEL_ID, buildSoundPanel(deckSoundSettings()));

  const persist = () => {
    api.storage.set(STORAGE_KEY, deckSoundSettings()).catch((e) => {
      console.error("Failed to save vinyl deck sound settings:", e);
    });
  };

  api.ui.onAction(MASTER_ACTION, (data) => {
    setDeckSoundSettings({ enabled: toggleValue(data) });
    render();
    persist();
  });

  for (const voice of VOICES) {
    api.ui.onAction(voiceActionId(voice.id), (data) => {
      setDeckSoundSettings({ voices: { [voice.id]: toggleValue(data) } });
      render();
      persist();
    });
  }

  // Paint immediately from the defaults, then repaint once storage answers. The
  // panel is reachable before an await would resolve, and an empty settings pane
  // that fills in a moment later looks broken.
  render();
  api.storage
    .get<DeckSoundSettings>(STORAGE_KEY)
    .then((stored) => {
      if (!stored) return;
      // Merged, not assigned: a stored object written before a voice existed
      // must not silence it by omission. See `voiceOn`.
      setDeckSoundSettings({
        enabled: stored.enabled === true,
        voices: stored.voices ?? {},
      });
      render();
    })
    .catch((e) => console.error("Failed to load vinyl deck sound settings:", e));
}
