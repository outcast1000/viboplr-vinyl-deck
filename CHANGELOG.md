## Unreleased

- **Cueing a stopped deck no longer lets a moment of audio out.** Changing track
  was only expressible as "play this track", so cueing a paused or stopped deck
  had to start it and take it straight back. On an app new enough to offer it the
  deck now places the needle without starting anything, cued to the exact groove
  it landed on rather than to 0:00. Older apps keep the previous behaviour.
- **The deck does almost no work per frame now.** It redraws at the display's
  refresh rate — 120Hz on the machine this was measured on — but almost nothing it
  draws changes that often: playback position advances about four times a second,
  the transport state goes whole songs without moving, and the strobe ring is
  deliberately stationary at 33. It was writing all of it every frame anyway.
  Measured over two seconds of ordinary playback: **2160 style and class writes
  before, 240 after** — the 240 being the platter's own rotation, the one thing
  that genuinely has to happen every frame. Nothing about the picture changes.

## 1.2.0

- **The deck zooms in while you cue.** Grab the headshell and the whole deck
  magnifies around the needle for as long as you hold it, so you can see the
  grooves — and the waveform pressed into them — while you are choosing where to
  drop. This is the gesture that needed it most: a band is the drag target, and on
  a full side a band is a few pixels of groove, so cueing meant aiming at
  something you could not read. Let go and it eases back.
  The lens is anchored on **the point you grabbed**, and stays there for the whole
  gesture. That is forced rather than chosen: it is the only anchor for which a
  hand holding still keeps naming the same groove as the zoom comes in. Anchor on
  the spindle and the needle is the first thing pushed off the edge; anchor on the
  needle and re-aim it as the needle moves, and it becomes a feedback loop — the
  anchor is derived from the radius, and the radius is measured against a record
  the anchor has moved. Near the run-out that loop runs away, which is why a drop
  at the end of the last track used to land at the start of the side.
  **The record is redrawn at the zoomed resolution rather than stretched.** A CSS
  scale over the existing canvas would have been a line of code and would have
  made the grooves bigger and blurrier — more pixels of the same picture, no more
  detail, which is the opposite of the point of looking closer. The surface is
  re-rasterised to match the magnification and dropped back afterwards, so what
  you see up close is really there.
  It zooms on the first movement, not on the press: cueing has always been a drag,
  and a click that resolves nothing should not flash the deck in and out. Under
  reduced motion the magnifier stays and only its travel goes — it is what makes a
  thin band aimable, so switching it off would be an accessibility setting working
  backwards.
- **You can now see where the needle actually is.** The headshell is an opaque
  block that sits directly on top of the one groove it is reading, so the thing
  you were aiming was the thing you could not see — magnifying it only made the
  block bigger. Cueing now draws a **ring at the needle's exact radius**, which on
  a record is the whole of what "position" means: it comes out either side of the
  shell and crosses the band edges, so the track you are about to drop into is
  visible rather than guessed. Alongside it a small readout names that track and
  the time you would land at — a radius identifies a groove but not a song, and
  "which one, how far in" is what a cue is really asking. Both appear only while
  you are cueing; a permanent ring would be a HUD line drawn across a record.
- **A record is pressed to the length of the music on it.** The bands were
  normalised to the queue's own running time, so they always filled the disc
  whatever was on it — one three-minute track covered the same surface as a full
  twenty-two-minute side, which is not a record, it is a pie chart. A side now
  takes only the share of the program area its running time earns: a single short
  track is a thin band of grooves near the rim with run-out all the way in, the
  way a 12" single actually looks, and a full side still reaches the run-out. The
  arm stops at the end of the pressing too, rather than being parked in blank
  vinyl that no track answers for.
  One consequence worth knowing: a side holding a handful of short tracks now
  presses genuinely thin bands, because that is genuinely how little music is on
  it. The cue magnifier is what makes those aimable.
- **Cueing no longer starts the deck.** Moving the arm says where the deck is, not
  whether it is running — on the desk you cue a stopped deck constantly and it
  stays stopped. Dropping the needle on a paused or stopped deck used to start the
  music and drop the arm with it, because changing track is only expressible as
  "play this track". The deck now takes that back: the arm stays exactly as high
  as you left it and the platter keeps doing whatever it was doing, at the new
  position.
- **The pitch scale's red zero mark no longer lies across the fader.** The
  graduations and the fader are both plain positioned boxes, so the one declared
  last wins — and the scale was last, painting its zero line straight over the
  knob. On the real deck the scale is printed on the plinth and the fader sits
  proud of it, which is now the order they are drawn in.
- **A cue can no longer skip the track it was aimed at.** The innermost groove of
  a band maps to exactly that track's duration — which is not a position inside
  it, it is the boundary with the next one — so dropping the needle at the end of
  a track seeked to the very end, the track ended on the spot, and the queue moved
  on. At the end of a side that advance wrapped, landing you back at the start.
  A drop now lands a moment inside the track, so it plays what you pointed at.

## 1.1.0

- **Two decks.** Alongside the bare record on black there is now a **silver
  direct-drive console**, after an SL-1200 MK7 seen from above: a brushed plinth,
  the platter sitting left of centre with its stroboscope dots showing around the
  record, an S-shaped arm on a real gimbal, the pitch fader, the 45 adaptor well,
  and a **START/STOP that actually starts and stops the platter**.
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
  are here: **START/STOP drives the motor and only the motor** — it brakes the
  platter and leaves the needle sitting in the groove of a record that has stopped
  turning — while the lever raises and lowers the arm. Either one alone silences
  the deck, which is the rule the whole thing runs on: motor stopped *or* head
  raised means paused, and both have to be clear before there is sound. So the two
  controls can disagree — pressing START with the arm up runs the platter and
  starts nothing, exactly as it would on the desk. The platter
  spins up and brakes rather than snapping, which is the SL-1200's party trick,
  and the strobe dots coast to a stop with it — they're painted on the platter.
  A pause from anywhere else (the spacebar, the now-playing bar) is treated as the
  lever, since pausing a turntable is what the lever is for.
- The button itself was the wrong object: a chunky gradient cap where the real one
  is a pale, nearly flat slab, brighter than the plinth around it, with a small
  wide-tracked legend rather than a label filling its face.
- **A long queue is pressed as SIDES.** Past about fifteen tracks the bands stop
  being legible, and past twenty each band is thinner than the land beside it —
  more gap than music, the inverse of what a record looks like. Worse, the band is
  the drag target, so at two pixels you can't aim a cue at a track. The deck now
  presses only the side holding what's playing, twelve tracks at a time, and
  etches SIDE 2 OF 4 into the dead wax where a pressing plant puts its matrix
  numbers. Crossing a boundary presses the next side; playing through one leaves
  the record alone. A queue that fits one side is unchanged and says nothing.
  A side is filled by TIME, ~22 minutes, the way a real one is — and that turns out
  to be the rule that keeps the pressing legible too. A track-count cap alone still
  allows a side holding one 30-minute track and eleven 2-minute ones, where the
  long one takes 58% of the record and the rest are squeezed to a few pixels;
  filling by time can't produce that, since the long track exceeds a side on its
  own and gets one to itself. A count cap survives as a backstop for the case time
  can't catch — sixty 20-second tracks fit inside 22 minutes and would press sixty
  hairlines.
- **A closer pass at the real deck.** The strobe band was inverted — dark dashes
  on silver, where the SL-1200's is a BLACK ring carrying rows of light dots, which
  is the one thing about that platter everyone recognises. It is now a dark band
  with three rows of dots at different sizes and densities. The arm base was a
  plain silver disc and read as a knob; it is now the dark housing with a chrome
  gimbal and machined collar that it is on the deck, with a ribbed counterweight on
  its stub. The pitch fader gained its printed tick scale and red zero mark, and
  the plinth palette moved to a neutral mid-silver instead of reaching near-white.
- **The stroboscope dots are actually visible.** They had never drawn at all: the
  mask that confines them to the band of platter the record leaves showing is
  written in percentages of the radius, but a bare `circle` radial-gradient means
  farthest-*corner*, so 100% was the distance to the square's corner and the ring
  landed entirely outside the disc. `closest-side` puts it back on the edge.
- **The arm is connected to its headshell.** The tube was being drawn at a fixed
  300px whatever the arm's real length, so it stopped short and the headshell —
  correctly placed at the arm's end — floated free. An `<svg>` is a *replaced*
  element: `position:absolute` with `left:0` and `right:0` but no width resolves to
  the element's intrinsic size and drops the right offset as over-constrained.
  Stating a width makes it stretch as intended.
  It then stops ~24px SHORT of the arm's end, on purpose. `armAngleDeg` solves for
  the stylus sitting at the arm's far point and the shell hangs backward from
  there, so a full-length tube terminated at the cartridge tip with the shell
  dangling off the far side of it — connected, but joined at the wrong end. A
  tonearm meets its headshell at the REAR. The finger lift moved to the front
  beside the stylus for the same reason: on the rear edge it made the tube look
  like it was plugging into a protruding tab.
- **The needle stays on its groove when the arm is up.** The cue lift was drawn as
  a nudge toward the viewer in real 3D, and a perspective projection scales
  everything about the deck's centre — so raising the arm walked the drawn stylus
  *outward*, along the very radius that says which track is playing. It measured
  1.7% of the record's radius on a small deck and 5.8% on a large one, because the
  rise scaled with the deck while the perspective stayed fixed; at full size the
  needle sat past the rim, off the record entirely. Seen from above a cue lift
  raises the stylus straight up anyway — it stays over the same groove — so the
  arm no longer moves at all. The height is carried by the light catching the tube
  and the shadow falling away, which was already doing most of the work.
- **The deck answers the host's pause and stop differently.** They are two
  gestures, not one: **pause** raises the arm where it stands and leaves the record
  turning under it (the cue lever, which is what a pause is on a turntable), while
  **stop** sweeps the arm off the record and lays it on its rest and brakes the
  platter. Until now the deck only ever saw a single `playing` flag, so it could
  draw at most one of the two — and would draw the wrong one half the time. Needs
  an app new enough to report the difference; on an older one a stop reads as a
  pause, as before.
- **The arm rest is somewhere the arm actually goes.** It used to be scenery: a
  chrome post drawn on the plinth that nothing ever touched. It is now where the
  arm parks — and the post's position and the park angle are one number, so it
  can't be nudged out from under the arm that's supposed to be sitting on it.
  Grabbing the headshell takes the arm off the rest, because that is what picking
  it up means.
- **The 33/45 buttons are the right object.** Pale slabs with small numerals, like
  START/STOP, with a small indicator lamp beside each — the face no longer fills
  with red, which was the wrong shape and drowned the plinth in colour.
- The glowing red strobe lamp is gone. The platter stopping already says the motor
  is off, and it read as a blob rather than the thin illuminator window it is.
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
