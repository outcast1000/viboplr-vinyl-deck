// The one live setting object in this plugin, and why it earns its place.
//
// index.ts says the deck has no settings, and means it: three cosmetic options,
// a panel, storage and an options object threaded into every mounted instance
// were all deleted, and the two liveries became separate visualizers precisely
// so that choosing between them needs none of that machinery back.
//
// Sound switches cannot be liveries. There are eleven of them, they are
// independent, and a visualizer picker offers one choice from a list — you
// cannot express "the needle drop but not the motor" as a thing to pick. Nor can
// they be mount-time constants: a checkbox that only takes effect after the deck
// is remounted reads as broken, and the deck is remounted only when the user
// changes skin or slot.
//
// So this is the narrowest version of the thing that was removed: one value, a
// set of live instances, and a broadcast. No panel state, no per-instance copies
// to drift, and a deck mounted after a change gets the current value rather than
// the default.

import {
  DEFAULT_SOUND_SETTINGS,
  type DeckSoundSettings,
  type DeckSounds,
  type VoiceId,
} from "./sounds";

let current: DeckSoundSettings = {
  ...DEFAULT_SOUND_SETTINGS,
  voices: { ...DEFAULT_SOUND_SETTINGS.voices },
};

const live = new Set<DeckSounds>();

export function deckSoundSettings(): DeckSoundSettings {
  return current;
}

/**
 * Apply a change everywhere at once.
 *
 * Merges rather than replaces `voices`, so a panel toggling one checkbox does
 * not have to send the other ten back — and so a stored object written before a
 * voice existed cannot silence it by omission.
 */
export function setDeckSoundSettings(patch: Partial<DeckSoundSettings>): DeckSoundSettings {
  current = {
    ...current,
    ...patch,
    voices: { ...current.voices, ...(patch.voices ?? {}) },
  };
  for (const s of live) s.setSettings(current);
  return current;
}

/** Convenience for the panel: flip one voice. */
export function setVoiceEnabled(id: VoiceId, on: boolean): DeckSoundSettings {
  return setDeckSoundSettings({ voices: { [id]: on } });
}

/**
 * Register a mounted deck's sound engine. Returns an unsubscriber for destroy().
 *
 * Applies the current settings immediately: a deck mounted after the user has
 * been through the panel must not start at the defaults and correct itself on
 * the first change.
 */
export function registerDeckSounds(s: DeckSounds): () => void {
  live.add(s);
  s.setSettings(current);
  return () => {
    live.delete(s);
  };
}

/** Test seam — drops every registration and returns to defaults. */
export function resetDeckSoundSettings() {
  live.clear();
  current = { ...DEFAULT_SOUND_SETTINGS, voices: { ...DEFAULT_SOUND_SETTINGS.voices } };
}
