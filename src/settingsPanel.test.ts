import { afterEach, describe, expect, it, vi } from "vitest";
import { VOICES } from "./sounds";
import {
  deckSoundSettings,
  registerDeckSounds,
  resetDeckSoundSettings,
  setDeckSoundSettings,
} from "./soundSettings";
import { MASTER_ACTION, PANEL_ID, buildSoundPanel, installSoundPanel, toggleValue, voiceActionId } from "./settingsPanel";
import type { HostViewNode, ViboplrHostApi } from "../types/viboplr-host";

function flatten(n: HostViewNode): HostViewNode[] {
  const kids = "children" in n && Array.isArray(n.children) ? n.children : [];
  return [n, ...kids.flatMap(flatten)];
}

function toggles(n: HostViewNode) {
  return flatten(n).filter((x): x is Extract<HostViewNode, { type: "toggle" }> => x.type === "toggle");
}

/** A host that records what the panel told it. */
function fakeApi() {
  const views: HostViewNode[] = [];
  const actions = new Map<string, (v: unknown) => void>();
  const stored: Record<string, unknown> = {};
  const api: ViboplrHostApi = {
    visualizers: { register: () => () => {}, unregister: () => {}, onMount: () => () => {} },
    ui: {
      setViewData: (_id, data) => views.push(data),
      onAction: (id, h) => actions.set(id, h),
    },
    storage: {
      get: async <T,>(k: string) => stored[k] as T | undefined,
      set: async (k, v) => {
        stored[k] = v;
      },
    },
  };
  return { api, views, actions, stored, last: () => views[views.length - 1] };
}

afterEach(() => resetDeckSoundSettings());

describe("the sound settings panel", () => {
  it("gives every voice its own toggle, plus the master", () => {
    // The panel is the only place a user can reach these. A voice with no
    // toggle is a noise they cannot turn off.
    const t = toggles(buildSoundPanel(deckSoundSettings()));
    expect(t).toHaveLength(VOICES.length + 1);
    for (const v of VOICES) expect(t.some((x) => x.action === voiceActionId(v.id))).toBe(true);
  });

  it("builds only node types the host can render", () => {
    // The host SKIPS an unrecognised node type — silently, with nothing in any
    // log. So an invented one is a hole in the panel that looks like a CSS bug
    // and cannot be traced from either side. This caught a `vstack` wrapper that
    // swallowed all eleven voice toggles while the master rendered fine.
    const allowed = new Set(["section", "text", "toggle", "settings-row"]);
    for (const n of flatten(buildSoundPanel(deckSoundSettings()))) {
      expect(allowed, `unknown node type: ${n.type}`).toContain(n.type);
    }
  });

  it("gives each toggle a distinct action, so none drives another's voice", () => {
    // Two toggles sharing an action id look perfect and silence the wrong sound.
    const ids = toggles(buildSoundPanel(deckSoundSettings())).map((x) => x.action);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows every voice as off while the master is off", () => {
    // Otherwise the panel claims eleven sounds are on while the deck is silent.
    const t = toggles(buildSoundPanel({ enabled: false, level: 1, voices: {} }));
    expect(t.filter((x) => x.checked)).toHaveLength(0);
  });

  it("reflects a voice the user switched off", () => {
    const panel = buildSoundPanel({ enabled: true, level: 1, voices: { motor: false } });
    const motor = toggles(panel).find((x) => x.action === voiceActionId("motor"));
    expect(motor?.checked).toBe(false);
    expect(toggles(panel).find((x) => x.action === voiceActionId("drop"))?.checked).toBe(true);
  });

  it("reads the host's toggle payload, which is an object and not a boolean", () => {
    // `PluginToggle` sends `{ value: !checked }`. Read as a bare boolean this is
    // always false, so every switch writes "off" and springs back — with nothing
    // logged on either side. It shipped that way until a live test caught it.
    expect(toggleValue({ value: true })).toBe(true);
    expect(toggleValue({ value: false })).toBe(false);
    // The shapes that must NOT read as on, so a contract change fails loudly
    // rather than turning every sound on by accident.
    expect(toggleValue(true)).toBe(false);
    expect(toggleValue(undefined)).toBe(false);
    expect(toggleValue(null)).toBe(false);
    expect(toggleValue({})).toBe(false);
  });

  it("applies, repaints and persists when a toggle is used", () => {
    const { api, actions, stored, last } = fakeApi();
    installSoundPanel(api);
    actions.get(MASTER_ACTION)?.({ value: true });
    expect(deckSoundSettings().enabled).toBe(true);
    expect(toggles(last()).find((x) => x.action === MASTER_ACTION)?.checked).toBe(true);

    actions.get(voiceActionId("motor"))?.({ value: false });
    expect(deckSoundSettings().voices.motor).toBe(false);
    expect(stored.sounds).toMatchObject({ enabled: true, voices: { motor: false } });
  });

  it("paints once immediately rather than waiting for storage", async () => {
    // The panel is reachable before an await resolves, and an empty settings
    // pane that fills in a moment later reads as broken.
    const { api, views } = fakeApi();
    installSoundPanel(api);
    expect(views.length).toBeGreaterThan(0);
    expect(views[0].type).toBe("section");
  });

  it("restores stored settings without silencing a voice added since", async () => {
    // Settings written before a voice existed simply don't mention it. Merging
    // rather than assigning is what keeps that from reading as "off".
    const { api, actions } = fakeApi();
    (api.storage as { get: (k: string) => Promise<unknown> }).get = async () => ({
      enabled: true,
      voices: { motor: false },
    });
    installSoundPanel(api);
    await vi.waitFor(() => expect(deckSoundSettings().enabled).toBe(true));
    expect(deckSoundSettings().voices.motor).toBe(false);
    // Never stored, so it must still be on.
    expect(deckSoundSettings().voices.drop).not.toBe(false);
    expect(actions.size).toBe(VOICES.length + 1);
  });

  it("survives storage being unreadable", async () => {
    // A profile with no stored value, or a failed read, must leave a usable
    // panel rather than an unhandled rejection.
    const { api, views } = fakeApi();
    (api.storage as { get: (k: string) => Promise<unknown> }).get = () => Promise.reject(new Error("nope"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => installSoundPanel(api)).not.toThrow();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(views.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("names the panel the manifest declares", () => {
    // The id is the join between manifest and code; a mismatch renders nothing
    // and reports no error anywhere.
    expect(PANEL_ID).toBe("vinyl-deck-sounds");
  });

  it("keeps a running deck in step with the panel", () => {
    // The whole reason soundSettings.ts exists: a checkbox that only took effect
    // on remount would look broken, and the deck is remounted only on a skin or
    // slot change.
    const applied: unknown[] = [];
    const fake = {
      setSettings: (s: unknown) => applied.push(s),
      frame() {}, drop() {}, lift() {}, click() {}, scrape() {}, endScrape() {}, destroy() {},
    };
    const off = registerDeckSounds(fake);
    setDeckSoundSettings({ enabled: true });
    expect(applied.length).toBeGreaterThan(1);
    off();
    const before = applied.length;
    setDeckSoundSettings({ enabled: false });
    expect(applied.length).toBe(before);
  });
});
