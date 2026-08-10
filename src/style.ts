// Styles for the deck, injected into the visualizer's shadow root.
//
// Every colour is a skin token. CSS custom properties inherit through a shadow
// boundary, so `var(--bg-primary)` here resolves to whatever skin the user has
// on, with no plumbing. The record body is derived from the skin rather than
// hardcoded black so a light skin tints it, and each derived value is exposed as
// an overridable `--vinyl-*` property.
//
// The canvas underneath paints black/white alpha ONLY (see surface.ts), which is
// why nothing here has to be kept in step with it and why a skin change needs no
// repaint.
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ NO BACKTICKS BELOW THIS LINE. The whole sheet is one template literal, so │
// │ a single backtick in a CSS comment — the natural way to quote a property  │
// │ name in prose — ends the string mid-CSS. It has cost five build breaks.   │
// │ Use "double quotes" in comments. TypeScript catches it, but reports       │
// │ TS1005 pointing at a comment, which tells you nothing about the cause.    │
// └──────────────────────────────────────────────────────────────────────────┘

export const DECK_CSS = `
:host { display: block; width: 100%; height: 100%; }
* { box-sizing: border-box; }

.deck {
  --vinyl-body: color-mix(in srgb, var(--bg-primary) 26%, #000);
  --vinyl-body-hi: color-mix(in srgb, var(--bg-primary) 46%, #000);
  --vinyl-sheen: #fff;
  --k: 1; /* record size / 368 reference — see repress() */
  /* Plinth box and its own 368 reference. Defaulted so a livery's furniture has
     something sane to lay out against on the frame between mount() and the first
     repress(), rather than collapsing to auto. */
  --plinth-w: 100%;
  --plinth-h: 100%;
  --pk: 1;
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* NO PERSPECTIVE, AND NO 3D ANYWHERE IN THE ARM. This is a top-down view of a
     record, so a radius on the disc IS a position in a track — and a perspective
     projection scales everything about the deck's centre, which walks the drawn
     stylus outward along that radius. The cue lift used to be a translateZ under
     a 620px perspective, and it measured +1.7% of the record radius on a small
     deck and +5.8% on a large one (the Z rises with the deck; the perspective was
     a fixed 620px), which put the needle past the rim while paused. Height is
     carried by brightness and the shadow instead — see .lifted below. */
}

/* Everything the deck is made of, and the only thing the cue magnifier scales.
   It exists so the zoom has somewhere to live that is INSIDE the clip: ".deck"
   carries overflow:hidden, and a transform on an element applies after that
   element's own clipping, so scaling ".deck" would blow the magnified picture
   out across the rest of the view. One level in, ".deck" stays a fixed window
   and the stage moves behind it.
   The flex centring moved here with the children — the stage is out of flow
   (absolute), so ".deck"'s own centring no longer reaches them. */
.stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* The origin is written per-frame by focusMagnifier(); this is only the value
     before the first drag. --zoom is the whole animation. */
  transform: scale(var(--zoom, 1));
  transform-origin: 50% 50%;
  transition: transform .22s var(--deck-ease, cubic-bezier(.22,.68,.25,1));
}
/* Only the SCALE is transitioned, and transform-origin deliberately is not: the
   origin is rewritten on every pointermove, and easing it would make the deck
   swim along behind the needle instead of pivoting about it. Changing the origin
   alone re-renders without firing a transition, since the transform VALUE is
   untouched. */
.zoomed .stage { --zoom: var(--cue-zoom, 2.2); }
/* The magnifier is an aid, not decoration, so it still zooms — but it arrives
   without the travel. */
.reduce-motion .stage { transition: none; }

.platter {
  position: relative;
  border-radius: 50%;
  flex: 0 0 auto;
}

/* The disc's TRUE outer edge is this box, not the canvas — the painter stops 2px
   short of it (see rEdge). So the hairline that states where the record ends has
   to be drawn here: a 1px inset highlight, crisp at any deck size, which is what
   the edge of a record actually looks like from above. Without it the vinyl faded
   out into whatever was behind it. */
.body {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%,
    var(--vinyl-body-hi) 8%, var(--vinyl-body) 55%, var(--vinyl-body) 100%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.22), 0 10px 26px -8px rgba(0,0,0,.7);
}
.spin { position: absolute; inset: 0; border-radius: 50%; transform-origin: 50% 50%; will-change: transform; }
canvas { position: absolute; inset: 0; border-radius: 50%; display: block; }

/* THE SLIPMAT. What is on the platter when there is no record — felt, not vinyl,
   so it is matte where the disc is glossy and that difference is most of what
   says "empty" at a glance.

   SHOWN ONLY WHEN THE PLATTER IS BARE, and that is forced rather than chosen.
   The obvious arrangement is to leave it there always, genuinely under the
   record — but the canvas paints the grooves in ALPHA ONLY (see the note on
   onSkinChange: that is what lets a skin restyle the vinyl without re-baking the
   surface), and the disc's actual colour comes from .body, which is a sibling
   OUTSIDE .spin. So a slipmat inside .spin is layered above the vinyl and
   below nothing but a transparent groove layer: the wordmark read straight
   through the record. It cannot be "under" the disc without leaving the layer
   that makes it turn.

   The noise is a repeating-conic-gradient at a very low alpha, which is a cheap
   way to get felt's directionless fuzz without an image — the release zip is
   manifest.json + index.js, so there is nowhere to put a texture. */
.slipmat {
  display: none;
  position: absolute; inset: 0; border-radius: 50%;
  background:
    repeating-conic-gradient(from 0deg, rgba(255,255,255,.030) 0deg .5deg, rgba(0,0,0,.030) .5deg 1deg),
    radial-gradient(circle at 42% 34%, #23262b 0%, #15171a 58%, #0d0f11 100%);
  box-shadow: inset 0 0 calc(18px * var(--k)) rgba(0,0,0,.55);
}
/* The wordmark, printed twice — upright and inverted. A deck is read from both
   sides of the booth, so a real slipmat says its name both ways up; it is also
   the thing that makes a stationary platter obviously a slipmat rather than a
   dark hole. Sunk into the felt rather than sitting on it: same ink, slightly
   darker than the mat, with a one-pixel light edge below. */
.slipmat span {
  position: absolute; left: 0; right: 0;
  text-align: center;
  font: 800 calc(30px * var(--k))/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  letter-spacing: -.02em;
  color: rgba(120,132,148,.30);
  text-shadow: 0 calc(1px * var(--k)) 0 rgba(255,255,255,.05);
}
.slipmat span:first-child { top: 27%; }
.slipmat span:last-child  { bottom: 27%; transform: rotate(180deg); }

/* NO RECORD. The disc and its label come off; the slipmat and the spindle stay.
   Everything else about the deck keeps working — the platter still turns, the
   strobe still drifts — because an empty deck is a working deck with nothing on
   it, not a disabled one. */
.empty .slipmat { display: block; }
.empty canvas,
.empty .shimmer,
.empty .label,
.empty .sheen,
.empty .iris { display: none; }
/* The disc's own edge highlight and cast shadow describe a record that isn't
   there, so the platter reads as its own rim instead. */
.empty .body {
  background: none;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.10);
}

/* Anisotropic shimmer — a whisper of radial texture that turns WITH the grooves.
   Kept near-invisible on purpose: a real record has no radial lines, and at any
   real opacity this reads as wireframe spokes rather than vinyl. The rotating
   LABEL is what actually sells the spin; this only helps when a track has no
   art. If in doubt, lower it. */
.shimmer {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  mix-blend-mode: screen; opacity: .02;
  background: repeating-conic-gradient(from 0deg,
    transparent 0deg 1.1deg,
    var(--vinyl-sheen) 1.35deg,
    transparent 1.6deg 3deg);
  -webkit-mask: radial-gradient(circle, transparent 34%, #000 44%, #000 92%, transparent 98%);
  mask: radial-gradient(circle, transparent 34%, #000 44%, #000 92%, transparent 98%);
}

/* Fixed in space, like a room light: the grooves turn under it and the smooth
   land rings glint differently. That contrast is how a real gap reads. */
.sheen {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  mix-blend-mode: screen; opacity: .85;
  background: conic-gradient(from 188deg, transparent 0deg,
    color-mix(in srgb, var(--vinyl-sheen) 26%, transparent) 13deg,
    color-mix(in srgb, var(--vinyl-sheen) 7%, transparent) 33deg,
    transparent 60deg, transparent 172deg,
    color-mix(in srgb, var(--vinyl-sheen) 17%, transparent) 190deg,
    color-mix(in srgb, var(--vinyl-sheen) 5%, transparent) 210deg,
    transparent 242deg);
}
.iris {
  position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
  mix-blend-mode: screen; opacity: .5;
  background: conic-gradient(from 196deg, transparent 0deg,
    rgba(120,200,255,.15) 9deg, rgba(255,140,220,.12) 19deg,
    rgba(255,220,120,.09) 29deg, transparent 44deg);
  -webkit-mask: radial-gradient(circle, transparent 34%, #000 42%, #000 88%, transparent 95%);
  mask: radial-gradient(circle, transparent 34%, #000 42%, #000 88%, transparent 95%);
}

/* The label is the album art, and it turns with the record. */
.label {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  border-radius: 50%; background-color: var(--bg-tertiary);
  background-size: cover; background-position: center;
  box-shadow: 0 0 0 1px rgba(0,0,0,.35), inset 0 0 0 calc(6px * var(--k)) rgba(0,0,0,.07);
}
/* THE CUE RING — where the needle is, stated as a groove.
   The headshell is an opaque block that covers the exact groove it reads, so the
   one thing you are aiming is the one thing hidden. On a record the position IS
   the radius, so a circle at that radius names it completely: it emerges either
   side of the shell, and it crosses the band boundaries so you can see which
   track you are about to land in rather than inferring it.
   Inside .platter but OUTSIDE .spin — it marks a place on the deck, not on the
   record, so it must not turn with the grooves. Sized in JS from the live radius;
   centred on the spindle by the margins. */
.cue-ring {
  position: absolute; left: 50%; top: 50%;
  width: 0; height: 0;
  margin: 0; translate: -50% -50%;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,.92);
  box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 0 calc(5px * var(--k)) rgba(255,255,255,.45);
  pointer-events: none;
  opacity: 0;
  transition: opacity .16s ease;
  z-index: 16;
}
/* Only while cueing. The rest of the time it would be a HUD line drawn across a
   record, which is the opposite of what this plugin is. */
.dragging .cue-ring { opacity: 1; }

/* THE CUE READOUT — the same answer in the terms you are actually choosing in.
   A radius names a groove but not a song, and "which track, how far in" is what a
   cue is really asking. Pinned to the bottom of the DECK and deliberately outside
   .stage, so the magnifier cannot blow it up and shove it off the edge: the zoom
   is there to enlarge grooves, and text has no detail to reveal. */
.cue-readout {
  position: absolute;
  left: 50%; bottom: calc(10px * var(--pk));
  translate: -50% 0;
  max-width: 86%;
  padding: calc(4px * var(--pk)) calc(10px * var(--pk));
  border-radius: 999px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: color-mix(in srgb, var(--bg-primary) 78%, #000);
  color: var(--text-primary, #fff);
  box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 calc(2px * var(--pk)) calc(8px * var(--pk)) rgba(0,0,0,.5);
  font: 600 calc(11px * var(--pk))/1.5 system-ui, sans-serif;
  pointer-events: none;
  opacity: 0;
  transition: opacity .16s ease;
  z-index: 30;
}
.dragging .cue-readout { opacity: 1; }

.hole {
  position: absolute; left: 50%; top: 50%; width: calc(11px * var(--k)); height: calc(11px * var(--k));
  margin: calc(-5.5px * var(--k)) 0 0 calc(-5.5px * var(--k)); border-radius: 50%;
  background: var(--bg-primary); box-shadow: inset 0 1px 2px rgba(0,0,0,.9);
  pointer-events: none;
}

/* There is no groove-scrub layer. The record is not a control: the headshell is
   the only thing you can grab, so a press on the surface does nothing at all.
   (A full-platter hit layer used to sit here at z-index 15 and cue from anywhere
   on the disc.) */

/* .armwrap and .armrise are inset:0, so they cover the WHOLE platter — without
   disabling them they swallow every press and even the headshell is unreachable.
   Only these two plus .arm. Do NOT add .armlift: it sits INSIDE .arm, so
   disabling it disables the arm's own graphics (the tube, pivot and headshell
   all live in it) and re-enabling .arm cannot recover them — .arm is a height:0
   box with no hittable area of its own. .head re-enables itself instead. */

/* Cue lever. The mechanism you actually operate: knob down = arm lowered onto the
   record, knob up = arm raised. Mounted in the bottom-right corner, the roomiest
   part of a square holding an inscribed circle and the one the arm never visits
   (see the placement note in visualizer.ts).
   Shares the arm's asymmetric timing — flick up, settle down — so the two read as
   one linkage rather than two animations that happen together.

   Three parts, so it reads as a mechanism rather than a pill: a housing sunk into
   the plinth, a travel slot cut down its middle, and a knurled knob that
   overhangs the housing so it looks pinchable. */
.lever {
  position: absolute;
  width: calc(11px * var(--k));
  height: calc(22px * var(--k));
  border-radius: calc(5.5px * var(--k));
  background: linear-gradient(180deg, #1b1e25, #0d1015);
  box-shadow:
    0 0 0 1px rgba(0,0,0,.7),
    inset 0 1px 1px rgba(255,255,255,.12),
    0 calc(2px * var(--k)) calc(5px * var(--k)) rgba(0,0,0,.45);
  /* Operable, not decorative: clicking it raises/lowers the head, which is the
     paused/playing state. */
  pointer-events: auto;
  cursor: pointer;
  z-index: 21;
}
/* The slot the knob rides in. */
.lever::before {
  content: "";
  position: absolute;
  left: 50%; margin-left: calc(-1.5px * var(--k)); width: calc(3px * var(--k));
  top: calc(3px * var(--k)); bottom: calc(3px * var(--k));
  border-radius: calc(2px * var(--k));
  background: #05070a;
  box-shadow: inset 0 1px 2px rgba(0,0,0,.9);
}
.lever:hover i { filter: brightness(1.15); }
.lever:active i { filter: brightness(.95); }
.lever i {
  position: absolute;
  /* Overhangs the housing on both sides — the part you'd actually pinch. */
  left: calc(-3px * var(--k)); right: calc(-3px * var(--k));
  height: calc(9px * var(--k));
  bottom: calc(2.5px * var(--k));
  border-radius: calc(3px * var(--k));
  background:
    repeating-linear-gradient(180deg,
      rgba(0,0,0,.20) 0 calc(1px * var(--k)),
      rgba(255,255,255,.10) calc(1px * var(--k)) calc(2px * var(--k))),
    linear-gradient(180deg, #f5f8fc, #bcc3cf 55%, #6e7583);
  box-shadow: 0 calc(1px * var(--k)) calc(2px * var(--k)) rgba(0,0,0,.55),
              inset 0 1px 1px rgba(255,255,255,.75);
  transition: bottom .58s cubic-bezier(.16,.84,.28,1), filter .15s ease;
}
.lifted .lever i {
  bottom: calc(100% - 11.5px * var(--k));
  transition: bottom .24s cubic-bezier(.34,1.5,.6,1), filter .15s ease;
}

/* Nothing in the arm assembly is hittable except the headshell. The tube,
   pivot and counterweight sweep across most of the record, and while they were
   grabbable they swallowed presses meant for the groove scrub underneath. Now
   they pass through, and .head re-enables itself below — a child can re-enable
   what its ancestor disabled, and .head is a real box, unlike .arm (height: 0,
   no hit area of its own; see the note above). */
.armwrap, .armrise, .arm { pointer-events: none; }

.armwrap { position: absolute; inset: 0; }

/* Kept as a plain pass-through. The lift used to translate the whole arm here,
   which raised the base along with the headshell — wrong: a tonearm's pivot is
   bolted down. */
.armrise { position: absolute; inset: 0; }

/* Rotation only, and the ONE transform that decides where the needle is. This
   updates every frame as the needle tracks, so it gets a short linear transition
   — just enough to smooth a cue jump. */
.arm {
  position: absolute; height: 0; z-index: 20; transform-origin: 0 50%;
  transform: rotate(var(--deg));
  transition: transform .22s linear;
}
/* Under the cursor the tracking ease reads as lag, so the arm follows the hand
   exactly while a drag is live. */
.dragging .arm { transition: none; }
/* Returning to the rest crosses most of the deck, so it gets a sweep rather than
   the flick a cue jump wants. Only the outbound leg: pressing START clears
   "motor-off" in the same frame that hands the arm its groove angle back, so the
   needle comes down at the tracking speed — which is the decisive half anyway. */
.motor-off .arm { transition: transform .55s cubic-bezier(.22,.68,.25,1); }

/* The LIFT, and it MOVES NOTHING.
   Seen from directly above, a cue lift raises the stylus straight up — it stays
   over the same groove, and the only things that change are how the light catches
   the arm and how far its shadow falls. That is exactly what is animated here:
   brightness on the tube and headshell, and the contact shadow separating and
   softening. No transform, so the needle cannot leave the band it is reading.
   Every attempt to add real height has been a registration bug: translateZ under
   a perspective scales the arm about the deck's centre and walks the stylus
   outward, a scale() lengthens the arm and does the same, and a rotateY about the
   pivot swings the arm behind the disc (it shares a stacking context with the
   platter) long before it reads as tilted. */
.armlift {
  position: absolute; left: 0; right: 0; top: 0; height: 0;
  filter: drop-shadow(calc(1px * var(--k)) calc(2px * var(--k)) calc(2px * var(--k)) rgba(0,0,0,.55));
  transition: filter .5s ease;
}
.lifted .armlift {
  filter: drop-shadow(calc(12px * var(--k)) calc(24px * var(--k)) calc(14px * var(--k)) rgba(0,0,0,.65));
  transition: filter .24s ease;
}
.tube {
  position: absolute; left: calc(8px * var(--k)); right: calc(30px * var(--k)); top: calc(-3px * var(--k)); height: calc(6px * var(--k)); border-radius: calc(3px * var(--k));
  background: linear-gradient(180deg, #e6eaf1, #a9b0bd 40%, #565c69);
  transition: filter .3s ease;
}
/* Raised toward the room light, so it catches more of it. On a black record this
   does more work than any shadow can. */
.lifted .tube, .lifted .head { filter: brightness(1.3) saturate(.9); }
.pivot {
  position: absolute; left: calc(-15px * var(--k)); top: calc(-15px * var(--k)); width: calc(30px * var(--k)); height: calc(30px * var(--k)); border-radius: 50%;
  background: radial-gradient(circle at 34% 28%, #8a919f, #3a3e48 58%, #14171d);
  box-shadow: 0 0 0 1px rgba(0,0,0,.55), inset 0 1px 2px rgba(255,255,255,.4);
}
.pivot::after {
  content: ""; position: absolute; inset: calc(9px * var(--k)); border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, #cfd5e0, #6a7180);
}
.counter {
  position: absolute; left: calc(-46px * var(--k)); top: calc(-9px * var(--k)); width: calc(30px * var(--k)); height: calc(18px * var(--k)); border-radius: calc(4px * var(--k));
  background: linear-gradient(180deg, #565c69, #1c1f26 70%, #10131a);
}
/* Headshell, offset ~22° like a real cartridge mount.
 *
 * LOAD-BEARING: armAngleDeg solves for the ARM'S FAR END sitting on the target
 * groove radius, so the stylus must be drawn at that far end. Previously the
 * cartridge sat mid-headshell and the head rotated about its own left edge,
 * which put the actual contact point ~10% of the radius inside where the maths
 * believed it was — at track 1, position 0 the needle visibly missed the rim.
 *
 * So: the head hangs BACKWARDS from the arm's end (right: 0), and it rotates
 * about 100% 50% — its right edge, i.e. the stylus — so the tilt is cosmetic
 * and cannot move the contact point. Don't reintroduce an offset here without
 * teaching armAngleDeg about it, and note that this transform is CONSTANT: the
 * lift deliberately doesn't touch it (see .armlift). */
.head {
  position: absolute; right: 0; top: calc(-10px * var(--k)); width: calc(32px * var(--k)); height: calc(20px * var(--k));
  border-radius: calc(3px * var(--k)) calc(6px * var(--k)) calc(6px * var(--k)) calc(3px * var(--k));
  transform: rotate(22deg); transform-origin: 100% 50%;
  background: linear-gradient(180deg, #f2f5f9, #aeb5c1 52%, #656c7a);
  box-shadow: inset 0 1px 1px rgba(255,255,255,.65), 0 0 0 1px rgba(0,0,0,.5);
  /* The one grabbable part of the arm — re-enabled after the assembly above
     turned hit-testing off. */
  pointer-events: auto;
  cursor: grab;
}
.head:active { cursor: grabbing; }
/* Cartridge, centred on the arm's end = the stylus/contact point. */
.head::after {
  content: ""; position: absolute; right: calc(-1px * var(--k)); top: 50%; margin-top: calc(-3px * var(--k));
  width: calc(8px * var(--k)); height: calc(11px * var(--k));
  border-radius: 1px 1px 3px 3px; background: linear-gradient(180deg, #3d434f, #babfc9);
}
/* Contact shadow under the headshell. Deliberately modest: on a near-black
   record a dark shadow has almost no contrast, so it can only ever be a
   supporting cue — it reads at the headshell's own lit edge, not against the
   vinyl. It still separates and softens when lifted, which helps at the boundary
   even where the blob itself is invisible. */
.shadow {
  position: absolute; right: 0; top: calc(-6px * var(--k)); width: calc(26px * var(--k)); height: calc(11px * var(--k));
  border-radius: 50%; background: rgba(0,0,0,.75);
  filter: blur(calc(2px * var(--k))); opacity: .5;
  transform: translate(calc(3px * var(--k)), calc(6px * var(--k))) scale(1);
  transition: transform .6s cubic-bezier(.16,.84,.28,1), filter .5s ease, opacity .5s ease;
}
.lifted .shadow {
  opacity: .55; filter: blur(calc(9px * var(--k)));
  transform: translate(calc(22px * var(--k)), calc(30px * var(--k))) scale(1.6);
  transition: transform .26s cubic-bezier(.34,1.5,.6,1), filter .26s ease, opacity .26s ease;
}
.lifted .shadow { opacity: 1; }

/* ===================================================================
   SL-1200 livery
   ===================================================================
   Scoped to .skin-sl1200 throughout, so it costs the plain deck nothing but
   bytes.

   THIS SKIN NAMES ITS OWN COLOURS, and is the one deliberate exception to the
   plugin's skin-token rule. The rest of the deck derives every colour from the
   app's skin so it cannot clash with one; a silver direct-drive deck is a
   depiction of a specific object, and a "brushed aluminium" that turned lilac
   under a purple skin would be a worse outcome than ignoring the skin. The
   CANVAS is untouched — grooves are still painted in alpha only, so the record
   itself still cannot break anything.

   GEOMETRY. The plinth is landscape (1.19:1, from the reference photo's 535x450)
   and takes the slot's short side as its WIDTH. Forcing it square was the first
   attempt and it put the record on top of the bottom-left controls. Percentages
   below are read straight off that photo: left/width against the plinth's width,
   top/height against its height. Circles use aspect-ratio so a single width
   percentage cannot skew them.

   SIZES use --pk (plinth/368), not --k (record/368). The record is deliberately
   smaller here to make room for the furniture, and scaling the furniture by the
   record would undo exactly the room it was given.

   NO BACKTICKS anywhere below — the whole sheet is one template literal. */

.skin-sl1200 {
  /* A record is black on any deck, so stop deriving the vinyl from the skin. */
  --vinyl-body: #17181b;
  --vinyl-body-hi: #25272c;
  /* Neutral, and a shade darker than the first pass — the reference plinth is a
     mid grey-silver, not the near-white the highlight ramp was reaching. */
  --mk7-silver: #b9bcbf;
  --mk7-silver-hi: #dee1e3;
  --mk7-silver-lo: #8e9296;
  --mk7-chrome-hi: #f6f8fa;
  --mk7-chrome-lo: #7d8186;
  --mk7-ink: #33363b;
  --mk7-red: #d22b28;
}

/* The plinth: brushed aluminium with a fine vertical grain. Centred on the same
   point as the platter, so the photo's x-fractions transfer directly — the
   platter's centre lands at 50% - 11% = 39% of the width, which is where it sits
   on the real deck. Pointer-transparent; only START/STOP re-enables itself. */
.skin-sl1200 .plinth {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--plinth-w);
  height: var(--plinth-h);
  transform: translate(-50%, -50%);
  border-radius: calc(9px * var(--pk));
  pointer-events: none;
  background:
    repeating-linear-gradient(90deg,
      rgba(255,255,255,.05) 0 1px, rgba(0,0,0,.035) 1px 3px),
    linear-gradient(160deg, var(--mk7-silver-hi) 0%, var(--mk7-silver) 45%,
      var(--mk7-silver-lo) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.75),
    inset 0 calc(-2px * var(--pk)) calc(5px * var(--pk)) rgba(0,0,0,.2),
    0 calc(12px * var(--pk)) calc(30px * var(--pk)) rgba(0,0,0,.5);
}

/* A record lying ON a platter, not floating above one. The generic disc shadow is
   a soft cast for a disc on a dark ground and it has nothing to land on here, so
   it spread a wide grey haze over the strobe band and blurred the very boundary
   the lip highlight is drawn to state. Tight and offset instead, lit from the
   top-left like everything else on this deck: what the eye is looking for is the
   millimetre of air under the edge, and a millimetre does not cast 26px. */
.skin-sl1200 .body {
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,.22),
    0 calc(1.5px * var(--pk)) calc(3px * var(--pk)) rgba(0,0,0,.75);
}

/* Platter rim and its stroboscope band.
   A 302mm record on a 332mm platter leaves ~10% of platter showing, and on an
   SL-1200 that margin is the strobe band: a BLACK ring carrying rows of light
   dots, with a bright machined lip outside it. This was inverted — dark dashes on
   silver — which is the one thing about the deck everyone recognises, so it read
   as some other turntable entirely.
   Sits inside .platter at a negative inset so it inherits the disc box and offset
   for free. All radii below are closest-side percentages: see the note on the dot
   mask about why that keyword is not optional. */
.skin-sl1200 .rim {
  position: absolute;
  inset: -6.5%;
  border-radius: 50%;
  pointer-events: none;
  background:
    /* The dark strobe band, over the machined lip. */
    radial-gradient(closest-side circle,
      transparent 87.5%, #131418 88.5%, #16181c 97%, transparent 97.8%),
    radial-gradient(circle at 36% 28%,
      var(--mk7-silver-hi), var(--mk7-silver) 55%, var(--mk7-silver-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.35),
              0 calc(4px * var(--pk)) calc(10px * var(--pk)) rgba(0,0,0,.4);
}

/* THREE ROWS of dots, not one row of dashes.
   The real platter carries several concentric rings — different counts for the
   speed/mains combinations — and their varying size and density is most of what
   makes the band read as a strobe rather than as a dotted border. Each row needs
   its own radial mask, and a mask applies to a whole element, so the rows are the
   element and its two pseudos. All three rotate together, since they are painted
   on the platter.
   Dots are arcs rather than circles; at this size and count the difference is
   invisible, and the arc width is tuned to the ring thickness so they read round. */
.skin-sl1200 .rim .dots {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  will-change: transform;
  /* Outer row: smallest and densest. */
  background: repeating-conic-gradient(from 0deg,
    #dfe3e6 0deg 1.05deg, transparent 1.05deg 2.2deg);
  /* CLOSEST-SIDE is load-bearing. A bare "circle" means farthest-CORNER, so 100%
     is the distance to the square's corner (0.707x its size) and the element's own
     round edge lands at ~70.7%. These bands are written as percentages of the
     RADIUS, so unqualified they mask to a ring outside the disc entirely and
     nothing draws at all — which is exactly what happened.
     (The .shimmer and .iris masks further up are also farthest-corner, but they
     were tuned by eye against that behaviour and read correctly — left alone.) */
  -webkit-mask: radial-gradient(closest-side circle, transparent 94.4%, #000 95%, #000 96.9%, transparent 97.4%);
  mask: radial-gradient(closest-side circle, transparent 94.4%, #000 95%, #000 96.9%, transparent 97.4%);
}
.skin-sl1200 .rim .dots::before,
.skin-sl1200 .rim .dots::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
}
/* Middle row. */
.skin-sl1200 .rim .dots::before {
  background: repeating-conic-gradient(from 0.6deg,
    #d6dade 0deg 1.5deg, transparent 1.5deg 3.1deg);
  -webkit-mask: radial-gradient(closest-side circle, transparent 91.9%, #000 92.5%, #000 94.3%, transparent 94.8%);
  mask: radial-gradient(closest-side circle, transparent 91.9%, #000 92.5%, #000 94.3%, transparent 94.8%);
}
/* Inner row: fewest and largest. */
.skin-sl1200 .rim .dots::after {
  background: repeating-conic-gradient(from 1.2deg,
    #cdd2d6 0deg 2.3deg, transparent 2.3deg 4.6deg);
  -webkit-mask: radial-gradient(closest-side circle, transparent 88.9%, #000 89.5%, #000 91.6%, transparent 92.1%);
  mask: radial-gradient(closest-side circle, transparent 88.9%, #000 89.5%, #000 91.6%, transparent 92.1%);
}

/* 45rpm adaptor well, top-left. */
.skin-sl1200 .adaptor {
  position: absolute;
  left: 2.8%; top: 7.6%; width: 10.4%; aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle at 36% 30%,
    var(--mk7-chrome-hi), var(--mk7-silver) 50%, var(--mk7-chrome-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.32),
              inset 0 calc(2px * var(--pk)) calc(3px * var(--pk)) rgba(255,255,255,.55);
}
.skin-sl1200 .adaptor::after {
  content: "";
  position: absolute; inset: 32%;
  border-radius: 50%;
  background: radial-gradient(circle, var(--mk7-silver-lo), var(--mk7-silver));
  box-shadow: inset 0 1px 2px rgba(0,0,0,.5);
}

/* Pop-up target light. */
.skin-sl1200 .target {
  position: absolute;
  left: 68.8%; top: 9.6%; width: 4.4%; aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 34%, var(--mk7-chrome-hi), var(--mk7-chrome-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.38);
}

/* Power rotary, bottom-left. */
.skin-sl1200 .power {
  position: absolute;
  left: 0.9%; top: 73.5%; width: 7.6%; aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle at 36% 30%,
    var(--mk7-chrome-hi), var(--mk7-silver-lo) 68%, var(--mk7-chrome-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.42),
              0 calc(1px * var(--pk)) calc(3px * var(--pk)) rgba(0,0,0,.45);
}
.skin-sl1200 .power::after {
  content: "";
  position: absolute; left: 45%; top: 10%; width: 10%; height: 42%;
  border-radius: 1px;
  background: var(--mk7-ink);
}

/* START/STOP. The only control here that does anything, and it drives the same
   action the cue lever does — on the real deck it is the primary transport, so
   leaving it decorative beside a working lever would be the odd choice. */
.skin-sl1200 .start {
  position: absolute;
  /* These are the FACE, not the footprint. The bezel below is a spread shadow, so
     the box is inset from where the button used to be drawn and the black frame
     grows back out to the old bounds — the whole control still occupies
     1.3%..12.3% across and 85%..93.4% down, which is where the photo puts it. */
  /* Taller than it was. Measured off the reference the face is 10% of the plinth
     across and very nearly the same down — it is close to square, and drawn at 7%
     it read as a wide switch rather than the chunky slab the real one is. */
  left: 1.5%; top: 85.6%; width: 10%; height: 9.6%;
  padding: 0;
  border: none;
  border-radius: calc(1.5px * var(--pk));
  /* Nearly flat and LIGHTER than the plinth — the real button is a pale slab, not
     the chunky gradient cap this used to be. Its whole presence on the deck comes
     from being brighter than the aluminium around it, so the heavy
     top-highlight-to-dark-bottom ramp read as the wrong object. */
  background: linear-gradient(180deg, #f4f6f8, #e5e7ea);
  box-shadow:
    /* THE BEZEL, and the reason this button is recognisable across a room. What
       the eye picks out on the real deck is not the pale slab, it is the black
       gasket frame around it: the only black-on-silver rectangle in that corner.
       A 1px dark outline was standing in for it, which at deck size is a hairline
       and reads as a border rather than as a part. A spread shadow grows the
       corner radius along with the box, which is exactly how the moulded frame
       follows the button's own corners. */
    0 0 0 calc(2.4px * var(--pk)) #0d0f12,
    /* The machined lip of the well the frame is sunk into. */
    0 0 0 calc(3px * var(--pk)) rgba(255,255,255,.4),
    inset 0 1px 0 rgba(255,255,255,.95),
    0 calc(2px * var(--pk)) calc(4px * var(--pk)) rgba(0,0,0,.4);
  color: var(--mk7-ink);
  /* Small, lightly tracked and low-contrast: on the real button the legend is a
     quiet caption, not a label filling the face. It is set LOWER CASE, which is
     how Technics print it — and small caps at .1em tracking was the one detail
     that kept the whole corner looking like a generic UI button. */
  font: 600 calc(3.9px * var(--pk))/1 system-ui, sans-serif;
  letter-spacing: .02em;
  opacity: .96;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: pointer;
}
.skin-sl1200 .start:hover { filter: brightness(1.03); }
.skin-sl1200 .start:active {
  background: linear-gradient(180deg, #dcdee1, #eceef0);
  box-shadow:
    0 0 0 calc(2.4px * var(--pk)) #0d0f12,
    0 0 0 calc(3px * var(--pk)) rgba(255,255,255,.4),
    inset 0 calc(1.5px * var(--pk)) calc(3px * var(--pk)) rgba(0,0,0,.3);
}

/* 33 / 45. Real buttons now that the contract carries a rate — they ask the host
   for 1x and 1.35x, and the lit one is driven by the host's rate rather than by
   their own clicks, so they stay right when it's changed from Settings. Both lit
   is 78, exactly how the real deck shows it. */
/* ONE bezel around BOTH buttons, which is how the deck is actually moulded: the
   pair sits in a single black frame with a slot between them, not as two
   separately outlined slabs. The frame is this element — the buttons are its flex
   children and its padding is the frame's thickness, so the gap between them is
   the frame showing through rather than a void.
   Bottom-aligned with START/STOP (both end at 93.4%), as in the photo, and
   flatter than they were: on the real deck these are barely a third of the height
   of START/STOP. Not the full third — the numerals have to stay legible at deck
   size, and that is the same trade the gap floor in geometry.ts makes. */
.skin-sl1200 .speeds {
  position: absolute;
  /* DOWN at the plinth's bottom edge, alongside START/STOP rather than above it.
     At 89.4% they sat up against the platter's lower-left curve with the two
     crowding each other; on the reference they are the lowest thing on the deck,
     clear of the disc entirely, and START/STOP is what they sit beside. */
  left: 12.6%; top: 94%; width: 10.6%; height: 2.9%;
  display: flex;
  gap: calc(1.5px * var(--pk));
  padding: calc(1.5px * var(--pk));
  border-radius: calc(1.8px * var(--pk));
  background: #0d0f12;
  box-shadow: 0 0 0 calc(0.7px * var(--pk)) rgba(255,255,255,.4),
              0 calc(1.5px * var(--pk)) calc(3px * var(--pk)) rgba(0,0,0,.4);
  pointer-events: auto;
}
/* Pale slabs with small dark numerals, matching START/STOP — on the real deck
   these are the same kind of button, just smaller. The face NEVER changes colour:
   a separate LED beside each numeral is what says which speed is selected, which
   is how the deck actually indicates it. Filling the whole button red was the
   wrong object and drowned the plinth in colour.
   No outline of their own: the shared frame around them already draws every edge
   they have, and a second one inside it read as a button within a button. */
.skin-sl1200 .speeds button {
  flex: 1;
  position: relative;
  /* NUMERAL LEFT, LAMP RIGHT. It was the other way round, and that is the wrong
     object: the printed numeral is the button's name and sits where a name goes,
     with the lit window outboard of it. */
  padding: 0 0 0 14%;
  border: none;
  border-radius: calc(0.8px * var(--pk));
  background: linear-gradient(180deg, #f4f6f8, #e5e7ea);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.95);
  color: var(--mk7-ink);
  font: 600 calc(3.6px * var(--pk))/1 system-ui, sans-serif;
  letter-spacing: .02em;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.skin-sl1200 .speeds button:hover { filter: brightness(1.03); }
.skin-sl1200 .speeds button:active {
  background: linear-gradient(180deg, #dcdee1, #eceef0);
  box-shadow: inset 0 calc(1px * var(--pk)) calc(2px * var(--pk)) rgba(0,0,0,.3);
}
/* The indicator lamp. Dark and sunken when the speed isn't selected.
   A LANDSCAPE window, not the portrait sliver this was: on the deck it is a wide
   little letterbox, wider than it is tall. Centred by "top" and "height" summing
   to 100%, because a percentage margin resolves against the container's WIDTH —
   the -21% that used to centre a 42% height only worked on a square button, and
   these are nowhere near square. */
.skin-sl1200 .speeds button::before {
  content: "";
  position: absolute;
  right: 9%; top: 34%;
  width: 26%; height: 32%;
  border-radius: calc(0.6px * var(--pk));
  background: #6d3330;
  box-shadow: inset 0 1px 1px rgba(0,0,0,.55);
  transition: background .15s ease, box-shadow .15s ease;
}
.skin-sl1200 .speeds button.on::before {
  background: linear-gradient(180deg, #ff6a60, var(--mk7-red));
  box-shadow: 0 0 calc(4px * var(--pk)) rgba(210,43,40,.7),
              inset 0 1px 1px rgba(255,255,255,.5);
}

/* Pitch fader. A real control now that the contract carries a rate: it trims the
   selected speed by up to +/-8%, the SL-1200's default range.
   The --travel property is 0 at the top of the slot and 1 at the bottom, written
   by frame() from the host's rate (and by the drag while the hand owns it). */
.skin-sl1200 .pitch {
  --travel: .5;
  position: absolute;
  left: 91.6%; top: 52.2%; width: 3.7%; height: 33.3%;
  border-radius: calc(3px * var(--pk));
  background: linear-gradient(180deg, #b4b7ba, #d6d8da);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.32),
              inset 0 calc(2px * var(--pk)) calc(4px * var(--pk)) rgba(0,0,0,.3);
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
}
.skin-sl1200 .pitch:active { cursor: grabbing; }

/* The +/- marks. Minus at the top, plus at the bottom: on a Technics you push the
   fader away from you to slow the record down, and that is the one thing about
   this control nobody can guess from its shape. */
.skin-sl1200 .pmark {
  position: absolute;
  left: 115%;
  color: var(--mk7-ink);
  opacity: .6;
  font: 600 calc(6px * var(--pk))/1 system-ui, sans-serif;
  pointer-events: none;
}
.skin-sl1200 .pminus { top: calc(-2px * var(--pk)); }
.skin-sl1200 .pplus { bottom: calc(-2px * var(--pk)); }

/* Live readout, under the fader. Blank at 0 — a deck at its quartz-locked speed
   doesn't announce itself, and a permanent "0.0%" would be noise. */
.skin-sl1200 .pval {
  position: absolute;
  left: 84%; top: 86.5%; width: 16%;
  text-align: center;
  color: var(--mk7-ink);
  opacity: 0;
  font: 600 calc(5px * var(--pk))/1 system-ui, sans-serif;
  pointer-events: none;
  transition: opacity .2s ease;
}
.skin-sl1200.off-speed .pval { opacity: .85; color: var(--mk7-red); }
.skin-sl1200 .pitch::before {
  content: "";
  position: absolute;
  left: 40%; top: 5%; width: 20%; height: 90%;
  border-radius: calc(2px * var(--pk));
  background: #494d51;
  box-shadow: inset 0 1px 2px rgba(0,0,0,.75);
}
/* The knob. Rides the slot from --travel, with its own height taken out of the
   range so it can't hang off either end. No transition: a fader has to track the
   hand exactly, and easing here reads as lag (same reason the tonearm drops its
   transition mid-drag). */
.skin-sl1200 .pitch i {
  position: absolute;
  left: -42%; right: -42%;
  top: calc(var(--travel) * (100% - 11%));
  height: 11%;
  border-radius: calc(2px * var(--pk));
  background: linear-gradient(180deg, var(--mk7-chrome-hi), var(--mk7-silver) 45%, var(--mk7-chrome-lo));
  box-shadow: 0 calc(1px * var(--pk)) calc(3px * var(--pk)) rgba(0,0,0,.55),
              inset 0 1px 1px rgba(255,255,255,.95);
  pointer-events: none;
}
.skin-sl1200 .pitch i::after {
  content: "";
  position: absolute; left: 8%; right: 8%; top: 42%; height: 16%;
  background: var(--mk7-red);
  border-radius: 1px;
}

/* Tick scale beside the slot, +8 at the top through 0 to -8, as printed on the
   plinth. A bare slot with a knob in it read as a generic slider; the graduations
   are most of what says "pitch". Purely decorative, and pointer-transparent so it
   cannot steal the drag from the fader. */
.skin-sl1200 .pscale {
  position: absolute;
  left: 87.6%; top: 51%; width: 3.2%; height: 35.5%;
  pointer-events: none;
  background: repeating-linear-gradient(180deg,
    rgba(51,54,59,.7) 0 1px, transparent 1px 6.25%);
}
/* The numerals, to the LEFT of their graduations — the side the reference prints
   them on, and the only side with plinth to spare, since the fader is hard
   against the deck's right edge. Centred on their own tick by the translate. */
.skin-sl1200 .pscale span {
  position: absolute;
  right: 118%;
  transform: translateY(-50%);
  font: 500 calc(3.4px * var(--pk))/1 system-ui, sans-serif;
  color: var(--mk7-ink);
  opacity: .55;
}
/* The zero mark: longer, and lit red like the deck's quartz-lock lamp. */
.skin-sl1200 .pscale::after {
  content: "";
  position: absolute;
  right: 0; top: 50%;
  width: 170%; height: 2px;
  margin-top: -1px;
  background: var(--mk7-red);
  box-shadow: 0 0 calc(3px * var(--pk)) rgba(210,43,40,.5);
}

/* RESET — the quartz lock. Snaps back to exactly the selected speed however far
   the fader has been pushed, keeping the 33/45 choice. Lights while off-speed,
   so there is always something visibly offering the way back. */
.skin-sl1200 .reset {
  position: absolute;
  /* ROUND, and higher. On the reference this is a circular push-button level
     with the fader's lower third, not the rounded square down at 81.5% — square
     was the tell that made it read as a fourth transport button rather than the
     odd one out it is. Still clear of the arm rest, which is why it sits a shade
     left of where the photo's own centre falls. */
  left: 85.2%; top: 78.8%; width: 3.6%; height: 3.6%;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: linear-gradient(180deg, var(--mk7-silver-hi), var(--mk7-silver-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.3);
  pointer-events: auto;
  cursor: pointer;
  transition: background .2s ease, box-shadow .2s ease;
}
.skin-sl1200 .reset:hover { filter: brightness(1.08); }
.skin-sl1200.off-speed .reset {
  background: linear-gradient(180deg, #ff6a60, var(--mk7-red));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.3), 0 0 calc(5px * var(--pk)) rgba(210,43,40,.55);
}

/* Tonearm rest — a real destination now, not scenery: START/STOP swings the arm
   back onto it.
   POSITION COMES FROM JS (repress(), from cfg.restAt) and only the box and the
   finish are here. That is deliberate: the park angle is derived from the same
   fraction, so a post placed in CSS could be nudged out from under the arm that
   is supposed to be sitting on it. left/top name the post's CENTRE. */
.skin-sl1200 .rest {
  position: absolute;
  width: 2.4%; height: 5.5%;
  transform: translate(-50%, -50%);
  border-radius: calc(2px * var(--pk));
  background: linear-gradient(180deg, var(--mk7-chrome-hi), var(--mk7-chrome-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.38);
}

/* Cast foot at the bottom edge. */
.skin-sl1200 .foot {
  position: absolute;
  left: 55.5%; top: 92%; width: 3.2%; aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, var(--mk7-silver-hi), var(--mk7-chrome-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.32);
}

/* Where the deck signs itself: bottom right, wordmark over the model line.
   That corner is the one the real object uses and the only large empty area of
   plinth left once the arm, the fader and the transport have their places — a
   centred line had to sit in the gap between controls and looked like a caption.

   Deliberately NOT the manufacturer's wordmark: reproducing a trademark in a
   shipped plugin is a different decision from imitating a shape. It is ours,
   which is also why the slipmat carries it — a custom-printed slipmat is what
   every DJ actually owns, so this is the more authentic object, not the safer
   one. */
.skin-sl1200 .brand {
  position: absolute;
  /* Not hard against the corner. On the reference the wordmark ends about a
     sixth of the plinth in from the right edge, which leaves the corner itself
     empty — that margin is what stops it reading as a sticker applied to the
     edge. */
  right: 16%; bottom: 3.5%;
  text-align: right;
  color: var(--mk7-ink);
}
.skin-sl1200 .brand b {
  display: block;
  font: 700 calc(11px * var(--pk))/1 Georgia, "Times New Roman", serif;
  letter-spacing: .01em;
  opacity: .82;
}
.skin-sl1200 .brand span {
  display: block;
  margin-top: calc(1.5px * var(--pk));
  font: 500 calc(4px * var(--pk))/1.3 system-ui, sans-serif;
  letter-spacing: .16em;
  text-transform: uppercase;
  opacity: .45;
}

/* --- the arm, in silver --- */

/* The straight tube gives way to an S. */
.skin-sl1200 .tube { display: none; }
/* STATING THE WIDTH IS LOAD-BEARING. An svg is a REPLACED element: with
   position:absolute and left:0 + right:0 but width:auto, CSS resolves the width to
   the element's INTRINSIC size — 300px by default — then treats the box as
   over-constrained and drops the right offset. The tube was drawn 300px long
   whatever the arm's real length, so it stopped short of the headshell entirely.

   AND IT STOPS SHORT OF THE ARM'S END ON PURPOSE. armAngleDeg solves for the
   STYLUS sitting at x = length, and the headshell hangs backward from there — so
   running the tube the full 100% terminated it at the cartridge tip, with the
   shell dangling off the far side of it. A tonearm joins the shell at its REAR.
   Ending ~24px short puts the tube's tip just inside the shell's footprint, and
   since .head paints after the svg it covers the joint, which reads as the tube
   entering the headshell.
   Slightly less than the shell's full 34px width: the shell is rotated about its
   stylus end, so its rear edge swings a little, and the overlap absorbs that
   rather than opening a gap at one extreme. */
.skin-sl1200 .sarm {
  position: absolute;
  left: 0;
  width: calc(100% - 24px * var(--pk));
  top: calc(-15px * var(--pk));
  height: calc(30px * var(--pk));
  overflow: visible;
}
/* preserveAspectRatio="none" stretches the viewBox to the arm's real length, so
   the stroke has to opt out of that scaling or it thins to a hair. Drawn twice:
   a dark under-stroke for the tube's shaded underside, then the bright one. */
.skin-sl1200 .sarm path {
  fill: none;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.skin-sl1200 .sarm .under {
  stroke: rgba(0,0,0,.5);
  stroke-width: calc(10.5px * var(--pk));
}
.skin-sl1200 .sarm .over {
  stroke: url(#armgrad);
  stroke-width: calc(7.5px * var(--pk));
}

/* The arm base. On the real deck this is a big BLACK housing sunk into the
   plinth, carrying a chrome gimbal, the anti-skating dial and the arm-height lock
   — dark and busy, and one of the two things the eye uses to place the deck. It
   was a plain silver disc, which read as a knob.
   It rotates with the arm, which is invisible: everything here is concentric. */
.skin-sl1200 .pivot {
  left: calc(-30px * var(--pk)); top: calc(-30px * var(--pk));
  width: calc(60px * var(--pk)); height: calc(60px * var(--pk));
  background:
    radial-gradient(circle at 38% 30%, #4a4d52 0%, #23262b 42%, #101216 78%, #0a0c0f 100%);
  box-shadow: 0 0 0 1px rgba(0,0,0,.6),
              inset 0 1px 1px rgba(255,255,255,.16),
              0 calc(4px * var(--pk)) calc(10px * var(--pk)) rgba(0,0,0,.5);
}
/* Chrome gimbal yoke at the centre. */
.skin-sl1200 .pivot::after {
  inset: calc(17px * var(--pk));
  background: radial-gradient(circle at 36% 30%,
    var(--mk7-chrome-hi), var(--mk7-silver) 46%, var(--mk7-chrome-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.45),
              0 calc(1px * var(--pk)) calc(3px * var(--pk)) rgba(0,0,0,.5);
}
/* The machined collar between housing and yoke. */
.skin-sl1200 .pivot::before {
  content: "";
  position: absolute;
  inset: calc(9px * var(--pk));
  border-radius: 50%;
  background: conic-gradient(from 210deg,
    #8d9196, #d7dbdf 12%, #6f7378 30%, #c2c6ca 52%, #63676c 70%, #b9bdc1 88%, #8d9196);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.5);
  z-index: 1;
}

/* Counterweight: a ribbed cylinder on its stub behind the pivot. Needs a hard
   edge and a dark underside or it dissolves into the plinth, which is the same
   silver — the first pass read as a white smudge. */
.skin-sl1200 .counter {
  left: calc(-72px * var(--pk)); top: calc(-13px * var(--pk));
  width: calc(38px * var(--pk)); height: calc(26px * var(--pk));
  border-radius: calc(5px * var(--pk));
  background: linear-gradient(180deg,
    #d9dde1 0%, #f2f4f6 14%, #b7bbc0 46%, #6a6e73 84%, #4d5155 100%);
  box-shadow: inset 0 1px 1px rgba(255,255,255,.9),
              0 0 0 1px rgba(0,0,0,.5),
              0 calc(3px * var(--pk)) calc(6px * var(--pk)) rgba(0,0,0,.5);
}
/* Knurling, so it reads as the thing you turn to balance the arm. */
.skin-sl1200 .counter::before {
  content: "";
  position: absolute;
  inset: 16% 10%;
  border-radius: calc(2px * var(--pk));
  background: repeating-linear-gradient(90deg,
    rgba(0,0,0,.26) 0 1px, rgba(255,255,255,.3) 1px calc(3px * var(--pk)));
  opacity: .55;
}
/* The stub joining it to the housing. */
.skin-sl1200 .counter::after {
  content: "";
  position: absolute;
  right: calc(-16px * var(--pk)); top: 40%;
  width: calc(18px * var(--pk)); height: 20%;
  background: linear-gradient(180deg, var(--mk7-silver-hi), #6f7378);
  border-radius: 1px;
  box-shadow: 0 0 0 1px rgba(0,0,0,.35);
}

/* Headshell: BLACK, not silver.
   The real one is a matte black shell on a knurled silver bayonet collar, and
   the colour is the whole reason it reads at deck size — a silver block on a
   silver arm over a silver plinth is one continuous bright shape, which is why
   ours used to look like a thickening of the tube rather than a part you could
   take off. Black is also what makes the cartridge and the finger lift legible
   as separate things hanging off it. */
.skin-sl1200 .head {
  width: calc(30px * var(--pk)); height: calc(17px * var(--pk));
  top: calc(-8.5px * var(--pk));
  border-radius: calc(1.5px * var(--pk));
  background:
    linear-gradient(180deg, #4a4d52 0%, #26282c 42%, #17181b 70%, #303338 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.22),
              inset 0 -1px 0 rgba(255,255,255,.10),
              0 0 0 1px rgba(0,0,0,.62),
              0 calc(2px * var(--pk)) calc(4px * var(--pk)) rgba(0,0,0,.45);
}
/* The bayonet collar — the knurled silver nut that locks the shell to the tube.
   It is the joint, so it goes at the REAR edge where the tube arrives, and the
   vertical banding is what says "knurled" at three pixels tall. */
.skin-sl1200 .head .collar {
  position: absolute;
  left: calc(-7px * var(--pk)); top: 50%;
  margin-top: calc(-5px * var(--pk));
  width: calc(9px * var(--pk)); height: calc(10px * var(--pk));
  border-radius: calc(1.5px * var(--pk));
  background:
    repeating-linear-gradient(90deg,
      rgba(0,0,0,.28) 0 calc(.7px * var(--pk)),
      rgba(255,255,255,.20) calc(.7px * var(--pk)) calc(1.4px * var(--pk))),
    linear-gradient(180deg, var(--mk7-chrome-hi), var(--mk7-silver) 50%, var(--mk7-chrome-lo));
  box-shadow: 0 0 0 1px rgba(0,0,0,.5);
}
/* Finger lift, at the FRONT beside the stylus — which is where it is on a real
   headshell, and where you'd actually pinch to cue by hand. It used to sit on the
   rear edge, so the tube appeared to plug into a protruding tab rather than into
   the shell: half of why the join looked like it came in from the wrong side.

   STANDS PERPENDICULAR TO THE SHELL. It was a flat bar lying along the shell's
   own axis, which gave it the same silhouette as the shell and the cartridge —
   so the three merged into one block and nothing read as a thing you could
   pinch. A lift is a tab you get a fingertip under; it has to break the outline
   to say so, and breaking the outline is also the only part of it that survives
   being drawn at deck size, where the whole shell is about thirty pixels. */
.skin-sl1200 .head::before {
  content: "";
  position: absolute;
  right: calc(3px * var(--pk)); top: calc(-8px * var(--pk));
  width: calc(4px * var(--pk)); height: calc(10px * var(--pk));
  border-radius: calc(1.5px * var(--pk)) calc(1.5px * var(--pk))
                 calc(.5px * var(--pk)) calc(.5px * var(--pk));
  /* Leaning forward, over the stylus, as the moulded ones do. Pivoting about its
     own base keeps the foot planted on the shell while the tip tilts. */
  transform: rotate(-8deg);
  transform-origin: 50% 100%;
  background: linear-gradient(180deg, var(--mk7-chrome-hi), var(--mk7-silver) 55%, var(--mk7-chrome-lo));
  box-shadow: 0 0 0 1px rgba(0,0,0,.45),
              0 calc(1px * var(--pk)) calc(2px * var(--pk)) rgba(0,0,0,.35);
}
/* Cartridge stays at the arm's far end — armAngleDeg solves for the stylus being
   exactly there, so this must not drift back along the headshell.
   Body in pale grey against the now-black shell, with the connector pins as a
   row of colour along its top edge: four tiny stripes are enough to read as pins
   at deck size, and they are the detail that says "cartridge" rather than
   "another block". */
.skin-sl1200 .head::after {
  right: calc(-1.5px * var(--pk));
  width: calc(10px * var(--pk));
  height: calc(13px * var(--pk));
  border-radius: calc(1px * var(--pk)) calc(1px * var(--pk)) calc(3px * var(--pk)) calc(3px * var(--pk));
  background:
    linear-gradient(90deg,
      rgba(214,68,60,.85) 0 22%,
      rgba(226,226,226,.85) 22% 44%,
      rgba(70,120,196,.85) 44% 66%,
      rgba(90,190,110,.85) 66% 88%,
      transparent 88%) 0 0 / 100% calc(2.5px * var(--pk)) no-repeat,
    linear-gradient(180deg, #d7dade 0%, #9aa0a8 55%, #5d636b 100%);
  box-shadow: 0 0 0 1px rgba(0,0,0,.55);
}

/* NOTE: "lifted" lands on .deck itself, so these are compound selectors, not
   descendant ones — the arm's own parts are what brighten. */
.skin-sl1200.lifted .head,
.skin-sl1200.lifted .sarm .over { filter: brightness(1.15); }
`;
