## 1.1.0

- **Two decks.** Alongside the bare record on black there is now a **silver
  direct-drive console**, after an SL-1200 MK7 seen from above: a brushed plinth,
  the platter sitting left of centre with its stroboscope dots showing around the
  record, an S-shaped arm on a real gimbal, the pitch fader, the 45 adaptor well,
  and a **START/STOP that actually starts and stops** (same action as the cue
  lever — on a real deck they are two controls over one motor).
- **A deck is not a setting.** Each livery is contributed to the host as its own
  visualizer, so you pick one from the same visualizer menu that offers the plain
  artwork. No settings panel came back to make this work: nothing is stored, and
  nothing mutates a running deck from underneath it. The skin is fixed when the
  deck mounts.
- **The silver deck mounts its arm at the real thing's proportions** — pivot
  215mm from the spindle, 230mm effective length, expressed against the record's
  radius. The bare deck can't: its disc is inscribed in the whole box, so the
  pivot would fall outside it and both numbers have to be pulled in. Shrinking the
  platter to make room for the controls is what buys the authentic geometry.
- **The 33 and 45 buttons work.** They set the playback rate the way a deck does:
  45 on a 33 pressing is 1.35× and the pitch goes up with it, because a turntable
  resamples rather than time-stretches. So picking 45 doesn't hurry the music, it
  misplays the record — which is the point. Needs a host with `actions.setRate`;
  on an older one they stay decorative.
- **START/STOP stops the platter; the cue lever lifts the arm.** (The platter
  really does stop — `setPlaying` is asynchronous from the deck's side, and the
  first cut of this cleared its own flag on the frames that arrive before the host
  catches up, so the button silently degraded back into a second cue lever.) They were doing
  the same animation, which made the big labelled button read as a second,
  redundant cue lever. They're different mechanisms on a real deck and now they
  are here: START/STOP brakes the platter to a halt and leaves the needle in the
  groove, the lever raises the arm and leaves the platter turning. The platter
  spins up and brakes rather than snapping, which is the SL-1200's party trick,
  and the strobe dots coast to a stop with it — they're painted on the platter.
  A pause from anywhere else (the spacebar, the now-playing bar) is treated as the
  lever, since nothing outside the deck stops a real motor.
- The button itself was the wrong object: a chunky gradient cap where the real one
  is a pale, nearly flat slab, brighter than the plinth around it, with a small
  wide-tracked legend rather than a label filling its face.
- **The pitch fader works too**, as a **trim on top of** the speed button: ±8%,
  the SL-1200's default range, with a centre detent and a live readout. Drag it —
  it bends the record continuously while you pull, because a fader that only
  applied on release would be a slider pretending to be a fader. Minus at the top,
  plus at the bottom, the Technics way round, and marked so you don't have to
  guess. **RESET** is the quartz lock: back to exactly the selected speed, keeping
  your 33/45 choice, and it lights whenever the deck is off-speed so there's
  always a visible way back.
- **Changing speed keeps the fader where it is**, as on a real deck — the buttons
  pick the speed, the fader trims it, and pressing 45 doesn't reach over and
  recentre your slider.
- **The stroboscope dots now work like real ones.** They hold still at 33 and
  crawl forward or backward off it, the same illusion a mains-frequency lamp
  produces on a real platter. It's the honest readout that the deck is set wrong,
  and it costs nothing.
- **The platter turns at the speed you picked**, accelerating into it rather than
  jumping — the angle is integrated per frame instead of derived from the clock,
  so a 33 → 45 press is continuous.
- Which speed is lit comes from the host's rate, not from the buttons' own
  clicks, so changing speed in Settings → Playback keeps the deck in step. Both
  lit is 78, exactly how the real deck shows it.
- The record itself is untouched and shared. Both decks press the same bands from
  the same waveforms and cue with the same maths, so they can't disagree about
  where a track sits.

The silver livery is the one place this plugin names its own colours instead of
deriving them from your app skin. A depiction of a specific object can't take its
palette from elsewhere — "brushed aluminium" that turned lilac under a purple skin
would be worse than ignoring the skin. The record's own surface is still painted
in alpha only, so it still cannot break one.

## 1.0.1

- **No settings.** The crop, the four platter tilts and the gap outline are gone,
  and so is the settings panel — the deck now has nothing to configure. None of
  the three answered a question a listener has, and two of them made it less of a
  record: the tilt forced cueing to read the radius off a perspective projection
  instead of the geometry, and the crop mirrored the whole arm assembly so the
  tonearm sat on the wrong side of the turntable. A real deck has a tonearm and a
  cue lever, so this one has a tonearm and a cue lever. Anything you had set is
  simply forgotten; the deck draws what "flat, full disc, no outlines" always did.
- **The cue lever works.** Click it to raise or lower the head — the lift was
  already the paused state, so now the control that depicts it operates it too.
  Reshaped into a housing, slot and knurled knob, and moved to the bottom-right
  corner — the roomiest part of a square holding an inscribed circle, and the one
  the arm never visits. It used to graze the record.
- **The headshell is the only handle.** Cueing used to work from anywhere on the
  record, and from anywhere on the arm. Now the disc is inert and the tube,
  pivot and counterweight pass through — you cue by the head, as you would on a
  real deck, and a stray click on the artwork can't jump the queue.
- **The head follows your hand.** It used to stay put until you released, then
  snap to the result; the arm now tracks the pointer for the whole drag.
- Offers itself for the fullscreen slot, so the deck can fill the whole screen
  rather than only the artwork's place.

Requires a host with `actions.setPlaying` for the lever; on an older one the
lever stays decorative and the rest is unchanged. The fullscreen placement is
simply never asked for by a host that has no such slot.

## 1.0.0

First release. A vinyl deck for the Now Playing view: your play queue pressed onto
a single-sided record, one groove band per track with band width proportional to
its duration, and the smooth black land between bands standing in for the
inter-track gap.

- Geometry derives from a real 12" LP — 302mm disc, 292mm maximum recorded
  diameter, 100mm label — so the unplayable outer band is the true ~3.3% of the
  radius rather than an invented moat.
- **The grooves are cut from each track's own waveform.** Loud passages read as
  brighter, denser grooves and quiet ones recede, so the texture of the record is
  the music. Uses only waveforms the app has already cached, so it costs nothing;
  tracks without one get an even groove.
- Cue by dragging the tonearm or scrubbing the grooves. Landing on another band
  plays that track; landing inside the one already playing seeks within it.
- The platter never stops. On pause the cue lever raises the front of the arm off
  the record while the base stays bolted down, as a real one does.
- The label is the current track's album art, and it turns with the record.
- Every colour comes from your skin. The record surface is painted in alpha only,
  so it cannot break a skin and needs no repaint when you change one.
- Choose the full disc or a magnified left-two-thirds crop, four platter tilts,
  and an optional outline of the track gaps.

Requires a host with the visualizer surface (`api.visualizers` plus the
`nowplaying` slot). Enable it, then pick it in Settings → Playback → "Now Playing
visualizer", or right-click the Now Playing artwork.
