# Viboplr Vinyl Deck

Your play queue, pressed onto a single-sided record.

One concentric groove band per track, band width proportional to its duration, and
the smooth black land between bands standing in for the inter-track gap — so the
shape of a playlist is legible at a glance: a side of two-minute punk songs is
visibly striped, a side of krautrock is two fat bands.

Fills the host's **`nowplaying`** slot, replacing the static artwork, and the
**`fullscreen`** one.

## Install

From the app: **Extensions → browse the gallery → Vinyl Deck**. Then enable it and
pick it in **Settings → Playback → "Now Playing visualizer"** (or right-click the
Now Playing artwork).

Ships disabled on first install, and marked experimental.

**It has no settings.** Nothing to configure, and no settings panel — see
[Why there are no options](#why-there-are-no-options).

## What it does

- **Cue by dragging the headshell.** Landing on another band plays that track;
  landing inside the one already playing seeks within it. The arm follows your
  hand for the whole drag and tells the app on release.
  The headshell is the **only** handle on the deck — the record is not a control
  and neither are the tube, pivot or counterweight. A press that never moves does
  nothing (the grab point says nothing about a groove), and a drag taken off the
  program area clamps to the nearest groove rather than being dropped.
- **The cue lever operates the head.** Click it to raise or lower — the raised
  arm is the paused state, so the lever that depicts it also drives it. Needs
  `actions.setPlaying`; on a host without it the lever is decorative.
- **The platter never stops.** On pause the cue lever raises the front of the arm
  off the record while the base stays put, which is what a real cue lever does.
- **The label is the album art**, and it turns with the record.
- **The grooves are cut from each track's own waveform**, where the host already
  had one cached. Loud passages read as brighter, denser grooves. A track without
  a cached waveform gets an even groove rather than a blank band.

## Why there are no options

The deck shipped three, and a settings panel to drive them: a magnified
left-two-thirds crop, four platter tilts, and a dashed outline over the
inter-track gaps. All three are gone, along with the panel, the stored settings
and the live options object that was threaded into every mounted instance so a
running deck could pick up a change mid-frame.

They went because none of them answered a question a listener actually has, and
two of them made the deck *less* of a record:

- **The tilt** put the disc in perspective, so cueing had to read the radius off
  the on-screen projection rather than the geometry — the one thing on the deck
  that has to be exact.
- **The crop** mirrored the whole arm assembly to keep the playhead in frame,
  which meant the tonearm sat on the wrong side of a turntable, and the cue lever
  had to be mirrored after it to avoid landing off-screen.
- **The gap outline** drew in the accent colour over a surface whose whole design
  is that it reads by its glint.

A real deck has a tonearm and a cue lever, so this one has a tonearm and a cue
lever. Nothing to configure is nothing to get wrong — and `frame()` no longer
diffs a settings string on every tick just in case.

## Geometry

Measured, not eyeballed. `src/geometry.ts` holds the real 12" LP dimensions and
every radius derives from them:

| | mm of disc radius |
|---|---|
| Disc | 151 |
| Rim (smooth lip) | 148.5 |
| Maximum recorded | 146 |
| Minimum recorded | 60 |
| Dead wax | 55 |
| Label | 50 |
| Inter-track land | ~1 |

So the unplayable outer band is ~5mm — **3.3% of the radius**. Anything wider reads
as a black moat that no record has.

Two floors keep that honest at real sizes:

- **`MIN_GAP_PX`** — at true proportions the gap is ~1.2px on a 368px deck and
  sub-pixel on a small one, so it would simply vanish, and the gap is the one thing
  the surface exists to show.
- **`MAX_GAP_SHARE`** — the floor is *per gap*, so a long queue would demand more
  total land than the program area has (a 60-track queue wants 118px of gap in a
  ~104px span) and the bands would run through the label. `layoutBands` shrinks the
  gap to fit instead, so the pressing always ends exactly on the run-out.

Read the painted gap via `gapAfter(bands, i)`, never `geo.gap` — once shrunk, the
band table is the only truthful source.

Unknown durations are tolerated, because they are common: a queue of metadata-only
streaming tracks presses even bands rather than collapsing to nothing.

## Development

```bash
npm install
npm run verify      # typecheck + test + build
npm test            # 56 tests
npm run build       # regenerates index.js
npm run package     # build + test + vinyl-deck.zip + update.json
```

`index.js` is a **build artifact that is committed**, because the gallery installs
straight from a release zip. CI fails if it doesn't match a fresh build.

### Host types

The plugin cannot import the app's sources, so `types/viboplr-visualizer.d.ts` is a
vendored copy of the host's visualizer contract. Re-sync it with:

```bash
npm run sync-types            # looks for ../viboplr
npm run sync-types -- /path/to/viboplr
```

Copying rather than hand-patching is deliberate: a hand-edited copy drifts
silently and nothing fails until a user's deck misbehaves.

`types/viboplr-host.d.ts` is a hand-written *subset* of the plugin API, and with
the settings panel gone it is down to the single call this plugin makes:
`api.visualizers.onMount`. It used to also carry narrowed `select` / `toggle` /
`text` / `section` view-node types (type-checking those caught three malformed
nodes an earlier hand-written JS version shipped silently) plus `log` and
`storage`. Add a member back when the plugin starts making the call — don't
vendor one speculatively, because an unused vendored type drifts from the host
with nothing to catch it.

### Things worth knowing before changing the code

- **The host owns the frame loop** and calls `frame(state)`. Never start your own
  `requestAnimationFrame` — the host stops calling an off-screen visualizer,
  honours reduced motion, and gives up on one that throws repeatedly.
- **`queueRevision`** is the signal for "redo per-queue work". Expensive layout and
  repaint happen once per queue change, not once per frame.
- **The sandbox has no ambient DOM.** `document` is `undefined` and `window` is a
  frozen stub, so the document comes from `host.root.ownerDocument` and dragging
  uses `setPointerCapture` on the plugin's own element.
- **`armAngleDeg` solves for the arm's FAR END** on the target groove radius, so
  the stylus must be drawn there. Drawing the cartridge partway back along the
  headshell silently shortens the arm and the needle misses the rim at track 1.
- **Measure the platter, never the canvas**, for pointer maths. The canvas lives
  inside the spinning layer, and `getBoundingClientRect()` on a rotated element
  returns the axis-aligned box of the rotated shape — its width breathes and its
  origin drifts every frame. That one mistake broke both cue gestures while the
  drawing still looked perfect.
- **The reduced-motion CSS guard does not cross a shadow boundary**, and could never
  reach a canvas. Honour `host.reducedMotion` explicitly.
- Rotating the groove canvas alone is **invisible** — it's concentric rings, so it's
  rotationally symmetric. The label and the shimmer are what make the spin read.

## Releasing

Bump `version` in `manifest.json`, add a `## x.y.z` section at the top of
`CHANGELOG.md`, then push a `vX.Y.Z` tag (or run the Release workflow manually).
CI verifies the manifest version matches the tag and that the zip has
`manifest.json` at its root.

## Licence

MIT
