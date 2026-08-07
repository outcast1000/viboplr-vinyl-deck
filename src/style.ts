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
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* Load-bearing, and the only reason any 3D remains here: the cue lift is a
     translateZ on the headshell (see .lifted .head), which is invisible without
     a perspective on an ancestor and a preserve-3d chain down to it. The platter
     itself is never rotated or scaled. */
  perspective: 620px;
  transform-style: preserve-3d;
}

.platter {
  position: relative;
  border-radius: 50%;
  transform-style: preserve-3d;
  flex: 0 0 auto;
}

.body {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%,
    var(--vinyl-body-hi) 8%, var(--vinyl-body) 55%, var(--vinyl-body) 100%);
  box-shadow: 0 10px 26px -8px rgba(0,0,0,.7);
}
.spin { position: absolute; inset: 0; border-radius: 50%; transform-origin: 50% 50%; will-change: transform; }
canvas { position: absolute; inset: 0; border-radius: 50%; display: block; }

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

.armwrap { position: absolute; inset: 0; transform-style: preserve-3d; }

/* Kept as a plain pass-through. The lift used to translate the whole arm here,
   which raised the base along with the headshell — wrong: a tonearm's pivot is
   bolted down. The rise is now a tilt about that pivot (see .armlift). */
.armrise {
  position: absolute; inset: 0;
  transform-style: preserve-3d;
}

/* Rotation only. This updates every frame as the needle tracks, so it gets a
   short linear transition — just enough to smooth a cue jump. */
.arm {
  position: absolute; height: 0; z-index: 20; transform-origin: 0 50%;
  transform-style: preserve-3d;
  transform: rotate(var(--deg));
  transition: transform .22s linear;
}
/* Under the cursor the tracking ease reads as lag, so the arm follows the hand
   exactly while a drag is live. */
.dragging .arm { transition: none; }

/* The LIFT.
   A tonearm's base is bolted down and only the front swings up, so nothing here
   transforms the whole arm — the pivot and counterweight never move. The rise is
   applied to the HEADSHELL alone (see .head below), which under the deck's
   perspective moves it toward the viewer: it grows, brightens, and projects
   outward off the groove. The tube's far end is hidden behind it, so the arm reads
   as tilted.
   A true out-of-plane rotateY about the pivot was tried and rejected: the arm
   shares a preserve-3d context with the platter, so past a few degrees it swings
   BEHIND the disc and is occluded outright. Not worth the fragility for a motion
   the top-down projection barely shows anyway. */
.armlift {
  position: absolute; left: 0; right: 0; top: 0; height: 0;
  transform-style: preserve-3d;
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
 * teaching armAngleDeg about it. */
.head {
  position: absolute; right: 0; top: calc(-10px * var(--k)); width: calc(32px * var(--k)); height: calc(20px * var(--k));
  border-radius: calc(3px * var(--k)) calc(6px * var(--k)) calc(6px * var(--k)) calc(3px * var(--k));
  transform: rotate(22deg) translateZ(0); transform-origin: 100% 50%;
  transition: transform .58s cubic-bezier(.16,.84,.28,1);
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
/* Paused: the cue lever raises the arm off the record in real Z. */
/* Never scale() the arm: that lengthens it, walking the contact point outward
   and putting the needle past the rim while paused. Height comes from
   translateZ under the deck's perspective, which is the honest cue anyway — a
   lifted arm really is nearer the eye.
   The headshell rises FURTHER than the pivot, because that is what a tonearm
   does: the pivot is fixed and the far end swings up. */
/* Quick and springy going up, slow and damped coming down — a cue lever, not a
   CSS transition. Same curves as the lever knob, so they read as one linkage. */
.lifted .head {
  transform: rotate(22deg) translateZ(calc(52px * var(--k)));
  transition: transform .24s cubic-bezier(.34,1.5,.6,1);
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
  --mk7-silver: #c4c7c9;
  --mk7-silver-hi: #eaecee;
  --mk7-silver-lo: #9a9ea2;
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

/* Platter rim and its stroboscope dots.
   A 302mm record on a 332mm platter leaves ~10% of platter showing, which is
   where the dots live. Sits inside .platter at a negative inset so it inherits
   the disc's box and offset for free. */
.skin-sl1200 .rim {
  position: absolute;
  inset: -6.5%;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(circle at 36% 28%,
    var(--mk7-silver-hi), var(--mk7-silver) 55%, var(--mk7-silver-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.3),
              0 calc(4px * var(--pk)) calc(10px * var(--pk)) rgba(0,0,0,.4);
}
/* The dots: a dashed ring in the band of rim the record leaves visible. Sized in
   degrees, so they stay round-ish at any deck size.
   Its own element, not a pseudo, because JS rotates it independently of the
   platter to reproduce the strobe illusion (see frame()). */
.skin-sl1200 .rim .dots {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  will-change: transform;
  background: repeating-conic-gradient(from 0deg,
    #16181c 0deg 1.3deg, transparent 1.3deg 4.2deg);
  -webkit-mask: radial-gradient(circle, transparent 88.5%, #000 90%, #000 97%, transparent 98.5%);
  mask: radial-gradient(circle, transparent 88.5%, #000 90%, #000 97%, transparent 98.5%);
}

/* The record's own drop shadow is a big soft one, right for a disc floating on
   black and wrong here — it washed straight over the rim and swallowed the strobe
   dots. On a deck the record is SEATED on the platter, so it gets a tight contact
   shadow and the rim keeps the soft one. */
.skin-sl1200 .body {
  box-shadow: 0 calc(2px * var(--pk)) calc(5px * var(--pk)) -1px rgba(0,0,0,.55);
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

/* Strobe lamp. Lit while the platter is driven, dimmed when the arm is up — the
   one piece of furniture that reads playback, because on the real deck it is the
   thing that tells you the platter is running. */
.skin-sl1200 .strobe {
  position: absolute;
  /* Further out and lower than the photo's 8.4%/75%. The platter's circle has
     receded by this height, but only just — at the photo's spot the rim clipped
     the lamp's inner corner, because this plinth is squarer than the real one and
     the disc reaches further left at the bottom. */
  left: 6.8%; top: 79%; width: 3.6%; height: 4.6%;
  border-radius: calc(2px * var(--pk));
  background: linear-gradient(180deg, #ff5b52, var(--mk7-red) 45%, #8e1b19);
  box-shadow: 0 0 calc(9px * var(--pk)) rgba(210,43,40,.8),
              inset 0 1px 1px rgba(255,255,255,.5);
  transition: opacity .3s ease, box-shadow .3s ease;
}
/* Dims with the MOTOR, not with the arm. The lamp exists to light the dots so you
   can read the platter's speed — a stopped platter has no speed to read, while a
   cued-up one (arm raised, platter spinning) still does. Tying this to the lifted
   state had it going dark at exactly the moment it was still useful. */
.skin-sl1200.motor-off .strobe {
  opacity: .28;
  box-shadow: inset 0 1px 1px rgba(255,255,255,.2);
}

/* START/STOP. The only control here that does anything, and it drives the same
   action the cue lever does — on the real deck it is the primary transport, so
   leaving it decorative beside a working lever would be the odd choice. */
.skin-sl1200 .start {
  position: absolute;
  left: 1.3%; top: 85%; width: 11%; height: 8.4%;
  padding: 0;
  border: none;
  border-radius: calc(2px * var(--pk));
  /* Nearly flat and LIGHTER than the plinth, with a thin dark outline — the real
     button is a pale slab, not the chunky gradient cap this used to be. Its whole
     presence on the deck comes from being brighter than the aluminium around it,
     so the heavy top-highlight-to-dark-bottom ramp read as the wrong object. */
  background: linear-gradient(180deg, #f2f4f6, #e4e6e9);
  box-shadow: 0 0 0 1px rgba(0,0,0,.45),
              inset 0 1px 0 rgba(255,255,255,.9),
              0 calc(1px * var(--pk)) calc(2px * var(--pk)) rgba(0,0,0,.25);
  color: var(--mk7-ink);
  /* Small, wide-tracked and low-contrast: on the real button the legend is a
     quiet caption, not a label filling the face. */
  font: 500 calc(4.2px * var(--pk))/1 system-ui, sans-serif;
  letter-spacing: .1em;
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
  box-shadow: 0 0 0 1px rgba(0,0,0,.45),
              inset 0 calc(1.5px * var(--pk)) calc(3px * var(--pk)) rgba(0,0,0,.3);
}
/* The recessed well the button sits in. */
.skin-sl1200 .start::before {
  content: "";
  position: absolute;
  inset: calc(-2px * var(--pk));
  border-radius: calc(3px * var(--pk));
  box-shadow: inset 0 1px calc(2px * var(--pk)) rgba(0,0,0,.28);
  pointer-events: none;
}

/* 33 / 45. Real buttons now that the contract carries a rate — they ask the host
   for 1x and 1.35x, and the lit one is driven by the host's rate rather than by
   their own clicks, so they stay right when it's changed from Settings. Both lit
   is 78, exactly how the real deck shows it. */
.skin-sl1200 .speeds {
  position: absolute;
  /* 13.4%, not the photo's 12.1%: START/STOP ends at 12.3% and the two were
     touching, which their shadows turned into an apparent overlap. On the real
     deck there is daylight between them. */
  left: 13.4%; top: 90.5%; width: 12.5%; height: 4.6%;
  display: flex;
  gap: 6%;
  pointer-events: auto;
}
.skin-sl1200 .speeds button {
  flex: 1;
  padding: 0;
  border: none;
  border-radius: calc(1.5px * var(--pk));
  background: linear-gradient(180deg, var(--mk7-silver-hi), var(--mk7-silver-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.28);
  color: var(--mk7-ink);
  font: 600 calc(4.5px * var(--pk))/1 system-ui, sans-serif;
  cursor: pointer;
  transition: background .18s ease, box-shadow .18s ease, color .18s ease;
}
.skin-sl1200 .speeds button:hover { filter: brightness(1.06); }
.skin-sl1200 .speeds button:active { filter: brightness(.92); }
.skin-sl1200 .speeds button.on {
  background: linear-gradient(180deg, #ff6a60, var(--mk7-red));
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.3), 0 0 calc(6px * var(--pk)) rgba(210,43,40,.6);
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

/* RESET — the quartz lock. Snaps back to exactly the selected speed however far
   the fader has been pushed, keeping the 33/45 choice. Lights while off-speed,
   so there is always something visibly offering the way back. */
.skin-sl1200 .reset {
  position: absolute;
  /* Right of the arm rest, not under it: at the photo's 83.2% the two boxes
     overlapped, which read as one broken control rather than two. */
  left: 86.6%; top: 81.5%; width: 3.4%; height: 3.4%;
  padding: 0;
  border: none;
  border-radius: calc(1.5px * var(--pk));
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

/* Tonearm rest, below where the arm parks. */
.skin-sl1200 .rest {
  position: absolute;
  left: 82.2%; top: 77.8%; width: 2.4%; height: 5.5%;
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

/* Model line, bottom centre.
   Deliberately NOT the manufacturer's wordmark: reproducing a trademark in a
   shipped plugin is a different decision from imitating a shape, and this line
   costs nothing to keep generic. */
.skin-sl1200 .brand {
  position: absolute;
  left: 58%; top: 88%; width: 30%;
  text-align: center;
  color: var(--mk7-ink);
  opacity: .5;
  font: 500 calc(4.5px * var(--pk))/1.4 system-ui, sans-serif;
  letter-spacing: .2em;
  text-transform: uppercase;
}

/* --- the arm, in silver --- */

/* The straight tube gives way to an S. */
.skin-sl1200 .tube { display: none; }
.skin-sl1200 .sarm {
  position: absolute;
  left: 0; right: 0;
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

/* Gimbal: three concentric silver rings, so the base reads as a mechanism rather
   than a dot. */
.skin-sl1200 .pivot {
  left: calc(-21px * var(--pk)); top: calc(-21px * var(--pk));
  width: calc(42px * var(--pk)); height: calc(42px * var(--pk));
  background: radial-gradient(circle at 34% 28%,
    var(--mk7-chrome-hi), var(--mk7-silver) 42%, var(--mk7-chrome-lo) 100%);
  box-shadow: 0 0 0 1px rgba(0,0,0,.42),
              0 calc(3px * var(--pk)) calc(7px * var(--pk)) rgba(0,0,0,.45);
}
.skin-sl1200 .pivot::after {
  inset: calc(8px * var(--pk));
  background: radial-gradient(circle at 38% 32%, var(--mk7-silver-hi), var(--mk7-chrome-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.32);
}
.skin-sl1200 .pivot::before {
  content: "";
  position: absolute;
  inset: calc(15px * var(--pk));
  border-radius: 50%;
  background: radial-gradient(circle at 40% 34%, var(--mk7-chrome-hi), var(--mk7-silver-lo));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.36);
  z-index: 1;
}
/* Counterweight, on its stub behind the pivot. */
/* Counterweight. Needs a hard edge and a darker underside or it dissolves into
   the plinth, which is the same silver — the first pass read as a white smudge. */
.skin-sl1200 .counter {
  left: calc(-58px * var(--pk)); top: calc(-10px * var(--pk));
  width: calc(36px * var(--pk)); height: calc(20px * var(--pk));
  border-radius: calc(4px * var(--pk));
  background: linear-gradient(180deg,
    var(--mk7-chrome-hi) 0%, var(--mk7-silver) 32%, #6f7378 88%, #55585c 100%);
  box-shadow: inset 0 1px 1px rgba(255,255,255,.9),
              0 0 0 1px rgba(0,0,0,.45),
              0 calc(3px * var(--pk)) calc(6px * var(--pk)) rgba(0,0,0,.5);
}
/* Knurling, so it reads as the thing you turn to balance the arm. */
.skin-sl1200 .counter::before {
  content: "";
  position: absolute;
  inset: 22% 12%;
  border-radius: calc(2px * var(--pk));
  background: repeating-linear-gradient(90deg,
    rgba(0,0,0,.22) 0 1px, rgba(255,255,255,.28) 1px calc(3px * var(--pk)));
  opacity: .5;
}
.skin-sl1200 .counter::after {
  content: "";
  position: absolute;
  right: calc(-14px * var(--pk)); top: 42%;
  width: calc(16px * var(--pk)); height: 16%;
  background: linear-gradient(180deg, var(--mk7-silver-hi), var(--mk7-chrome-lo));
  border-radius: 1px;
}

/* Headshell: a squarer silver block with a finger lift. */
.skin-sl1200 .head {
  width: calc(34px * var(--pk)); height: calc(19px * var(--pk));
  top: calc(-9.5px * var(--pk));
  border-radius: calc(2px * var(--pk));
  background: linear-gradient(180deg, var(--mk7-chrome-hi), var(--mk7-silver) 46%, var(--mk7-chrome-lo));
  box-shadow: inset 0 1px 1px rgba(255,255,255,.95),
              0 0 0 1px rgba(0,0,0,.48),
              0 calc(2px * var(--pk)) calc(4px * var(--pk)) rgba(0,0,0,.4);
}
.skin-sl1200 .head::before {
  content: "";
  position: absolute;
  left: calc(-9px * var(--pk)); top: 34%;
  width: calc(11px * var(--pk)); height: calc(3px * var(--pk));
  border-radius: calc(1.5px * var(--pk));
  background: linear-gradient(180deg, var(--mk7-chrome-hi), var(--mk7-chrome-lo));
  box-shadow: 0 1px 1px rgba(0,0,0,.4);
}
/* Cartridge stays at the arm's far end — armAngleDeg solves for the stylus being
   exactly there, so this must not drift back along the headshell. */
.skin-sl1200 .head::after {
  right: calc(-1px * var(--pk));
  width: calc(9px * var(--pk));
  height: calc(12px * var(--pk));
  background: linear-gradient(180deg, #2f343b, #b6bbc2);
}

/* NOTE: "lifted" lands on .deck itself, so these are compound selectors, not
   descendant ones — the arm's own parts are what brighten. */
.skin-sl1200.lifted .head,
.skin-sl1200.lifted .sarm .over { filter: brightness(1.15); }
`;
