var __viboplrPlugin = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/geometry.ts
	/**
	* A real 12" LP, in millimetres of disc *radius*.
	*
	* These are the numbers the whole surface derives from. The unplayable outer
	* band is only `disc - maxRecorded` = ~5mm, i.e. 3.3% of the radius — inventing
	* a wider one reads as a black moat that no record actually has.
	*/
	var LP_MM = {
		disc: 151,
		rim: 148.5,
		maxRecorded: 146,
		minRecorded: 60,
		deadWax: 55,
		label: 50,
		/** Inter-track land. ~1mm on a real pressing. */
		gap: 1
	};
	/**
	* Ceiling on the share of the program area the inter-track lands may consume.
	*
	* `MIN_GAP_PX` is a floor per gap, so a long enough queue would demand more
	* total land than the program area has — a 60-track queue wants 118px of gap in
	* a 104px span — and the bands would run straight through the label. Capping
	* the total and dividing it down keeps the pressing inside its geometry. Past
	* this density the deck is unreadable anyway; the contract it must not break is
	* that the last band ends exactly on the run-out.
	*/
	var MAX_GAP_SHARE = .5;
	/**
	* The default mount: compressed on purpose.
	*
	* A real SL-1200 sits its pivot at 1.42·rEdge with a 1.52·rEdge effective length
	* (215mm and 230mm against a 151mm record). Those don't fit a deck whose disc is
	* *inscribed* in its box — the pivot would land outside it — so the plain deck
	* pulls both in. A skin that shrinks the platter to make room for a plinth can
	* afford the true numbers; see skins.ts.
	*/
	var ARM = {
		pivotAngleDeg: -38,
		pivotDistance: 1.12,
		length: 1.28
	};
	/** Build the radii for a deck rendered `size` px across. */
	function buildGeometry(size) {
		const rEdge = Math.max(1, size / 2 - 2);
		const mm = (v) => rEdge * (v / LP_MM.disc);
		return {
			size,
			cx: size / 2,
			cy: size / 2,
			rEdge,
			rRim: mm(LP_MM.rim),
			rLeadIn: mm(LP_MM.maxRecorded),
			rProgIn: mm(LP_MM.minRecorded),
			rDeadWax: mm(LP_MM.deadWax),
			rLabel: mm(LP_MM.label),
			gap: Math.max(2, mm(LP_MM.gap))
		};
	}
	/**
	* Width of the land ring below `bands[i]`, derived from the band table rather
	* than from `geo.gap` — `layoutBands` shrinks the gap when a dense queue can't
	* afford the full one, so the table is the only truthful source.
	*/
	function gapAfter(bands, i) {
		const next = bands[i + 1];
		return next ? Math.max(0, bands[i].inner - next.outer) : 0;
	}
	/**
	* Press a list of track durations into concentric bands, outermost first.
	*
	* Unknown durations are real and common — a metadata-only plugin or streaming
	* track often has none — so when *no* track carries a usable duration the
	* bands are split evenly rather than collapsing to zero width. A partially
	* known list keeps the known proportions and gives the unknown tracks nothing,
	* which is the honest reading: we don't know how long they are.
	*/
	function layoutBands(durations, geo) {
		const n = durations.length;
		if (n === 0) return [];
		const safe = durations.map((d) => typeof d === "number" && Number.isFinite(d) && d > 0 ? d : 0);
		const total = safe.reduce((s, d) => s + d, 0);
		const weights = total > 0 ? safe.map((d) => d / total) : safe.map(() => 1 / n);
		const span = geo.rLeadIn - geo.rProgIn;
		const gap = n > 1 ? Math.min(geo.gap, span * MAX_GAP_SHARE / (n - 1)) : 0;
		const usable = Math.max(0, span - gap * (n - 1));
		const bands = [];
		let r = geo.rLeadIn;
		for (let i = 0; i < n; i++) {
			const width = usable * weights[i];
			bands.push({
				index: i,
				outer: r,
				inner: r - width,
				width,
				durationSecs: safe[i]
			});
			r = r - width - (i < n - 1 ? gap : 0);
		}
		return bands;
	}
	/**
	* Which track, and how far into it, sits at radius `r`.
	*
	* A radius inside a land ring resolves to the *end* of the band above it: the
	* needle is physically between tracks, and reporting the track it just left is
	* less surprising than reporting the one it hasn't reached.
	*/
	function radiusToPosition(bands, r) {
		if (bands.length === 0) return null;
		if (r >= bands[0].outer) return {
			index: 0,
			positionSecs: 0
		};
		for (const b of bands) {
			if (r <= b.outer && r >= b.inner) {
				const frac = b.width > 0 ? (b.outer - r) / b.width : 0;
				return {
					index: b.index,
					positionSecs: frac * b.durationSecs
				};
			}
			if (r < b.inner && b.index < bands.length - 1) {
				if (r > bands[b.index + 1].outer) return {
					index: b.index,
					positionSecs: b.durationSecs
				};
			}
		}
		const last = bands[bands.length - 1];
		return {
			index: last.index,
			positionSecs: last.durationSecs
		};
	}
	/** Radius of the groove `positionSecs` into track `index`. */
	function positionToRadius(bands, index, positionSecs, geo) {
		const b = bands[index];
		if (!b) return geo.rLeadIn;
		if (b.durationSecs <= 0) return b.outer;
		const frac = Math.max(0, Math.min(1, positionSecs / b.durationSecs));
		return b.outer - frac * b.width;
	}
	/** Clamp a radius to the playable program area. */
	function clampToProgram(r, geo) {
		return Math.max(geo.rProgIn, Math.min(geo.rLeadIn, r));
	}
	function buildArmMount(geo, spec = ARM) {
		const ang = spec.pivotAngleDeg * Math.PI / 180;
		const distance = geo.rEdge * spec.pivotDistance;
		return {
			px: geo.cx + distance * Math.cos(ang),
			py: geo.cy + distance * Math.sin(ang),
			length: geo.rEdge * spec.length,
			distance
		};
	}
	/**
	* Rotation (deg, CSS-positive = clockwise) that puts the stylus on radius `r`.
	*
	* Law of cosines on the triangle centre-pivot-stylus. Two solutions exist; we
	* take the one that keeps the arm on the same side as its pivot rather than
	* sweeping it across the label.
	*
	* CONTRACT: this solves for a stylus at exactly `mount.length` from the pivot —
	* i.e. at the arm element's FAR END. Whatever renders the arm must draw the
	* contact point there. Drawing the cartridge partway back along the headshell
	* (the natural way to draw one) silently shortens the effective arm and puts the
	* needle inside its true radius — most visibly at track 1, position 0, where it
	* should be sitting on the very rim. See the `.head` rules in style.ts.
	*/
	function armAngleDeg(r, geo, mount) {
		const { distance: D, length: L } = mount;
		const cos = (D * D + L * L - r * r) / (2 * D * L);
		const alpha = Math.acos(Math.max(-1, Math.min(1, cos)));
		return (Math.atan2(geo.cy - mount.py, geo.cx - mount.px) - alpha) * 180 / Math.PI;
	}
	//#endregion
	//#region src/surface.ts
	/** Base groove brightness. */
	var GROOVE_BASE = .125;
	/**
	* How much the cached waveform shows in the groove texture.
	*
	* The studio-black surface keeps this subtle: grooves stay essentially uniform
	* and the track's dynamics only whisper through. Raising it slides toward an
	* overtly data-driven surface; 0 makes the grooves perfectly even.
	*/
	var WAVE_PRESENCE = .075;
	/** Radial distance between painted grooves, px. */
	var GROOVE_PITCH = 1.15;
	/** Radial distance between the coarser lead-in / run-out guide grooves, px. */
	var GUIDE_PITCH = 1.5;
	/**
	* Paint the record surface. Cheap enough to redraw on resize, but it only needs
	* to run when the size or the pressing changes — never on a skin change, and
	* never per animation frame (rotation is a CSS transform on a parent).
	*/
	function paintVinylSurface(canvas, geo, bands, peaks) {
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
		canvas.width = Math.max(1, Math.round(geo.size * dpr));
		canvas.height = Math.max(1, Math.round(geo.size * dpr));
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, geo.size, geo.size);
		const { cx, cy, rEdge, rRim, rLeadIn, rProgIn, rDeadWax, rLabel } = geo;
		const ring = (r, w, colour) => {
			if (r <= .5) return;
			ctx.lineWidth = w;
			ctx.strokeStyle = colour;
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.stroke();
		};
		const white = (a) => `rgba(255,255,255,${a})`;
		const black = (a) => `rgba(0,0,0,${a})`;
		ring(rEdge - 1, 2, white(.17));
		ring(rRim, 1, black(.9));
		for (let r = rRim - 1.2; r > rLeadIn; r -= GUIDE_PITCH) ring(r, 1, white(.07));
		ring(rLeadIn + .6, 1, black(.95));
		bands.forEach((b, i) => {
			const p = peaks?.[i];
			const n = p ? p.length : 0;
			for (let r = b.outer; r >= b.inner; r -= GROOVE_PITCH) {
				const frac = b.width > 0 ? (b.outer - r) / b.width : 0;
				const amp = n > 0 ? p[Math.min(n - 1, Math.floor(frac * n))] : .5;
				ring(r, .85, white(GROOVE_BASE + amp * WAVE_PRESENCE));
			}
			const gap = gapAfter(bands, i);
			if (gap > 0) {
				const gOut = b.inner;
				const gIn = b.inner - gap;
				ctx.fillStyle = black(1);
				ctx.beginPath();
				ctx.arc(cx, cy, gOut, 0, Math.PI * 2);
				ctx.arc(cx, cy, gIn, 0, Math.PI * 2, true);
				ctx.fill();
				ring(gOut - .5, 1, white(.2));
				ring(gIn + .5, 1, white(.05));
			}
		});
		ring(rProgIn - 1, 1.4, black(.95));
		for (let r = rProgIn - 3; r > rDeadWax; r -= 3.2) ring(r, 1, white(.04));
		ring(rLabel + .5, 1, white(.09));
	}
	//#endregion
	//#region src/style.ts
	var DECK_CSS = `
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
	//#endregion
	//#region src/skins.ts
	/**
	* The original: a record on black, and nothing that isn't the record or the arm.
	*/
	var STUDIO = {
		name: "studio",
		aspect: 1,
		platterScale: 1,
		offsetX: 0,
		offsetY: 0,
		arm: ARM,
		furniture: false
	};
	var SKINS = {
		studio: STUDIO,
		sl1200: {
			name: "sl1200",
			aspect: 1.19,
			platterScale: .64,
			offsetX: -.11,
			offsetY: 0,
			arm: {
				pivotAngleDeg: -23,
				pivotDistance: 1.42,
				length: 1.52
			},
			furniture: true,
			leverAt: {
				x: .905,
				y: .47
			}
		}
	};
	/** Unknown names fall back to the plain deck rather than rendering nothing. */
	function skinConfig(skin) {
		return SKINS[skin] ?? STUDIO;
	}
	/** 45 and 78 expressed against a 33⅓ pressing. */
	var RATE_45 = 45 / (100 / 3);
	/**
	* The speeds a rate can be sitting on.
	*
	* Their ±8% windows do not overlap — 33 reaches 1.08, 45 starts at 1.242 — so a
	* rate maps back to exactly one (speed, trim) pair. At the real deck's *other*
	* range, ±16%, they would just touch (1.16 vs 1.134), and the deck would have to
	* remember which button you pressed instead of deriving it. Modelling ±8% only is
	* what buys the stateless design.
	*/
	var BASES = [
		1,
		RATE_45,
		78 / (100 / 3)
	];
	/** Split a playback rate into the speed it sits on and the trim off it. */
	function decomposeRate(rate) {
		const safe = Number.isFinite(rate) && rate > 0 ? rate : 1;
		let best = {
			basis: 1,
			percent: 0
		};
		let bestErr = Infinity;
		for (const basis of BASES) {
			const percent = (safe / basis - 1) * 100;
			if (Math.abs(percent) < bestErr) {
				bestErr = Math.abs(percent);
				best = {
					basis,
					percent
				};
			}
		}
		return best;
	}
	/** Recombine a speed and a trim into the rate to ask the host for. */
	function composeRate(basis, percent) {
		return basis * (1 + clampPercent(percent) / 100);
	}
	function clampPercent(percent) {
		if (!Number.isFinite(percent)) return 0;
		return Math.max(-8, Math.min(8, percent));
	}
	/**
	* Knob travel (0 = top of the slot, 1 = bottom) for a trim.
	*
	* DOWN IS FASTER, which is the Technics convention: the + marks are at the front
	* of the deck, nearest the user, and you push the fader away to slow the record
	* down. The +/- marks beside the slot say so on screen, since it is the one thing
	* here nobody can guess from the shape.
	*/
	function percentToTravel(percent) {
		return .5 + clampPercent(percent) / 16;
	}
	/** Inverse of `percentToTravel`, with the centre detent a real fader has. */
	function travelToPercent(travel) {
		const percent = (Math.max(0, Math.min(1, travel)) - .5) * 8 * 2;
		return Math.abs(percent) < .35 ? 0 : percent;
	}
	/** Fader label, e.g. "+3.2%" / "0.0%". */
	function formatPercent(percent) {
		const p = clampPercent(percent);
		return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`;
	}
	//#endregion
	//#region src/visualizer.ts
	/**
	* Platter spin-up and braking time constants, ms.
	*
	* The SL-1200's headline spec is reaching 33⅓ in a third of a turn, and its
	* electronic brake stops it faster still. Exponential easing, so these are ~63%
	* marks: 220ms reaches speed in about half a second, 110ms stops it in a quarter.
	*/
	var SPINUP_TAU_MS = 220;
	var BRAKE_TAU_MS = 110;
	/** Plinth furniture. Decorative except for START/STOP and the speed buttons. */
	var PLINTH_HTML = "<div class=\"plinth\"><div class=\"adaptor\"></div><div class=\"target\"></div><div class=\"power\"></div><div class=\"strobe\"></div><button class=\"start\" type=\"button\">START&#183;STOP</button><div class=\"speeds\"><button class=\"s33\" type=\"button\" aria-label=\"33 rpm\">33</button><button class=\"s45\" type=\"button\" aria-label=\"45 rpm\">45</button></div><div class=\"pitch\"><span class=\"pmark pminus\">&#8722;</span><span class=\"pmark pplus\">+</span><i></i></div><div class=\"pval\"></div><button class=\"reset\" type=\"button\" aria-label=\"Reset pitch\"></button><div class=\"rest\"></div><div class=\"foot\"></div><div class=\"brand\">Direct Drive</div></div>";
	/**
	* The S-shaped arm tube.
	*
	* Endpoints are load-bearing: the path starts at the pivot (0,13) and ends at the
	* stylus (100,13), so however the bend is drawn the straight-line distance the
	* geometry solves for is unchanged. `preserveAspectRatio="none"` stretches the
	* viewBox to the arm's real length, which is why the stroke opts out of scaling.
	*/
	var SARM_SVG = "<svg class=\"sarm\" viewBox=\"0 0 100 26\" preserveAspectRatio=\"none\" aria-hidden=\"true\"><defs><linearGradient id=\"armgrad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f4f6f8\"/><stop offset=\".5\" stop-color=\"#c9cbcd\"/><stop offset=\"1\" stop-color=\"#82868b\"/></linearGradient></defs><path class=\"under\" d=\"M0,13 C20,13 30,7 52,7 C74,7 80,17 100,13\"/><path class=\"over\" d=\"M0,13 C20,13 30,7 52,7 C74,7 80,17 100,13\"/></svg>";
	/**
	* The deck, in one of its liveries.
	*
	* `skin` is NOT a setting — each livery is contributed to the host as its own
	* visualizer, so the user picks one from the visualizer picker and this value is
	* fixed for the instance's whole life. That is deliberate: 1.0.1 removed every
	* option and the settings panel with them, and this adds a second deck without
	* bringing any of that back. There is still nothing to configure, no stored
	* preference, and no options object mutated behind a running instance.
	*
	* What each skin may change is presentation and *mounting* — the plinth, the
	* colours, where the platter sits, how long the arm is. What it must not change
	* is the record: the pressing, the groove painting and the cue maths are shared,
	* so both decks agree about where a track is.
	*/
	function createVinylDeckVisualizer(skin = "studio") {
		const cfg = skinConfig(skin);
		let host;
		let root;
		let deck;
		let platter;
		let spin;
		let canvas;
		let label;
		let arm;
		let lever;
		let dots = null;
		let s33 = null;
		let s45 = null;
		let pitch = null;
		let pval = null;
		/**
		* True while the pitch fader is under the hand.
		*
		* Same reason as `dragging` on the tonearm: frame() positions the knob from the
		* host's rate, and the host doesn't know about the drag until we send it, so a
		* frame landing mid-gesture would yank the knob back under the cursor.
		*/
		let scrubbingPitch = false;
		/**
		* Platter angle, ACCUMULATED rather than derived from timeMs.
		*
		* `(timeMs / 1800) * 360` is fine at a fixed speed, but multiplying it by the
		* rate makes the whole history rescale, so the record visibly jumps the instant
		* the speed changes. Integrating the delta keeps the picture continuous through
		* a 33 → 45 press, which is what a real platter does — it accelerates, it does
		* not teleport.
		*/
		let spinAngle = 0;
		/** Strobe-dot angle, integrated the same way. See frame(). */
		let dotAngle = 0;
		let lastMs = null;
		/** Last `playing` seen in frame(). The lever states the value it wants rather
		*  than toggling, per the contract, so it has to know the current one. */
		let playing = false;
		/** Last `rate` seen in frame(). Drives the platter's speed, the strobe drift
		*  and which speed button is lit. */
		let rate = 1;
		/**
		* Whether the MOTOR is off, as distinct from the music being paused.
		*
		* A deck has two independent mechanisms that both stop the sound, and they look
		* nothing alike: START/STOP cuts the platter and leaves the arm down, while the
		* cue lever lifts the arm and leaves the platter spinning. The host has only one
		* `playing` flag, so which of the two we're depicting is genuinely this deck's
		* own state — the one thing here worth remembering locally.
		*
		* Self-correcting: any frame that reports playback clears it, because sound
		* means the platter must be turning however it was started.
		*/
		let motorStopped = false;
		/** Previous frame's `playing`, so the motor flag can be cleared on the rising
		*  edge rather than the level. See frame(). */
		let wasPlaying = false;
		/** Platter speed, eased toward its target so the deck spins up and brakes
		*  instead of snapping. In units where 1 is 33⅓. */
		let spinVel = 1;
		/**
		* True between pointerdown and pointerup on the headshell.
		*
		* While it is set, frame() must NOT write the arm angle. The host's position
		* doesn't change until the drag is committed on release, so frame() would
		* rewrite the angle from the old position on the very next tick and snap the
		* head back under the user's cursor — which read as the arm not moving at all.
		*/
		let dragging = false;
		/** The plugin sandbox passes `document: undefined` and a frozen `window`, so
		*  ambient DOM is unavailable by design. Everything comes through the one
		*  handle the contract grants: the shadow root. */
		let doc;
		let geo = buildGeometry(2);
		let mountPoint = buildArmMount(geo);
		let bands = [];
		let size = {
			width: 0,
			height: 0
		};
		let lastRevision = -1;
		let lastArt = null;
		let currentIndex = -1;
		const unsubs = [];
		/** Lay out and repaint. Called on a queue or size change — never per frame. */
		function repress(tracks) {
			const durations = tracks.map((t) => t.durationSecs);
			const box = Math.max(40, Math.min(size.width, size.height));
			const plinthW = box;
			const plinthH = box / cfg.aspect;
			geo = buildGeometry(Math.max(40, plinthW * cfg.platterScale));
			mountPoint = buildArmMount(geo, cfg.arm);
			bands = layoutBands(durations, geo);
			deck.style.setProperty("--plinth-w", `${plinthW}px`);
			deck.style.setProperty("--plinth-h", `${plinthH}px`);
			deck.style.setProperty("--pk", String(plinthW / 368));
			if (cfg.offsetX || cfg.offsetY) platter.style.transform = `translate(${cfg.offsetX * plinthW}px, ${cfg.offsetY * plinthH}px)`;
			platter.style.width = `${geo.size}px`;
			platter.style.height = `${geo.size}px`;
			canvas.style.width = `${geo.size}px`;
			canvas.style.height = `${geo.size}px`;
			label.style.width = `${geo.rLabel * 2}px`;
			label.style.height = `${geo.rLabel * 2}px`;
			deck.style.setProperty("--k", String(geo.size / 368));
			arm.style.left = `${mountPoint.px}px`;
			arm.style.top = `${mountPoint.py}px`;
			arm.style.width = `${mountPoint.length}px`;
			const k = geo.size / 368;
			const leverW = 11 * k;
			const leverH = 22 * k;
			if (cfg.leverAt) {
				const platterLeft = (plinthW - geo.size) / 2 + cfg.offsetX * plinthW;
				const platterTop = (plinthH - geo.size) / 2 + cfg.offsetY * plinthH;
				lever.style.left = `${cfg.leverAt.x * plinthW - platterLeft - leverW / 2}px`;
				lever.style.top = `${cfg.leverAt.y * plinthH - platterTop - leverH / 2}px`;
			} else {
				const diagonal = geo.rEdge * 1.2 * Math.SQRT1_2;
				const inset = 6 * k;
				lever.style.left = `${Math.min(geo.cx + diagonal - leverW / 2, geo.size - leverW - inset)}px`;
				lever.style.top = `${Math.min(geo.cy + diagonal - leverH / 2, geo.size - leverH - inset)}px`;
			}
			paintVinylSurface(canvas, geo, bands, tracks.map((t) => t.peaks));
		}
		/**
		* Screen point → groove radius.
		*
		* Measure the PLATTER, never the canvas. The canvas lives inside the spinning
		* layer, and getBoundingClientRect() on a rotated element returns the
		* axis-aligned box of the rotated shape — so its width breathes by up to a
		* factor of root-2 and its origin drifts every frame. Measuring it made every
		* computed radius wrong by a varying amount, which silently broke both cue
		* gestures while the drawing still looked perfect.
		*
		* The unit factor keeps this honest if the platter is ever laid out at a size
		* other than the geometry it was built for.
		*/
		function radiusAt(clientX, clientY) {
			const rect = platter.getBoundingClientRect();
			const unit = rect.width / geo.size || 1;
			const x = (clientX - rect.left) / unit - geo.cx;
			const y = (clientY - rect.top) / unit - geo.cy;
			return Math.hypot(x, y);
		}
		/**
		* Cue by dragging the headshell. This is the ONLY cue gesture: the record
		* itself is not a control. Pressing the disc used to scrub the grooves, which
		* meant a stray click anywhere on the surface jumped the queue — and made the
		* arm look like something that merely followed along rather than the thing you
		* operate. A tonearm is the handle; the record just turns.
		*
		* Uses pointer capture on the element itself rather than window listeners: the
		* sandbox exposes no ambient `window`, and capture is the right primitive
		* regardless — the drag keeps tracking outside the disc and can't be stolen by
		* another element. (Pointer events, not HTML5 DnD, which the repo bans in this
		* webview.)
		*/
		function onDown(e) {
			if (e.button !== 0 || bands.length === 0) return;
			e.preventDefault();
			const target = e.currentTarget;
			let last = null;
			dragging = true;
			deck.classList.add("dragging");
			const move = (ev) => {
				const r = clampToProgram(radiusAt(ev.clientX, ev.clientY), geo);
				last = radiusToPosition(bands, r);
				arm.style.setProperty("--deg", `${armAngleDeg(r, geo, mountPoint).toFixed(2)}deg`);
			};
			const up = () => {
				dragging = false;
				deck.classList.remove("dragging");
				target.removeEventListener("pointermove", move);
				target.removeEventListener("pointerup", up);
				target.removeEventListener("pointercancel", up);
				if (!last) return;
				if (last.index === currentIndex) host.actions.seek(last.positionSecs);
				else host.actions.playQueueIndex(last.index);
			};
			try {
				target.setPointerCapture(e.pointerId);
			} catch {}
			target.addEventListener("pointermove", move);
			target.addEventListener("pointerup", up);
			target.addEventListener("pointercancel", up);
		}
		/**
		* Ask for the opposite of what we were last shown. Shared by the cue lever and
		* START/STOP.
		*
		* States the value rather than toggling, per the contract — a visualizer renders
		* from a snapshot that may be a frame stale, and a toggle read against a stale
		* snapshot inverts. The `typeof` guard keeps an older host without the action
		* degrading to the decorative controls it had before, instead of throwing on
		* every click.
		*/
		function toggleTransport() {
			if (typeof host.actions.setPlaying !== "function") return;
			host.actions.setPlaying(!playing);
		}
		/**
		* Ask the host for a playback rate.
		*
		* Guarded like `setPlaying`: a host older than the speed contract has no
		* `setRate`, and there the buttons stay decorative rather than throwing. The
		* host clamps whatever we send and owns the only route back to normal, so this
		* plugin never has to be the thing standing between a user and 1x.
		*/
		function setRate(r) {
			if (typeof host.actions.setRate !== "function") return;
			host.actions.setRate(r);
		}
		/** Paint the fader knob and its readout for a trim, without asking the host. */
		function showPitch(percent) {
			if (pitch) pitch.style.setProperty("--travel", String(percentToTravel(percent)));
			if (pval) pval.textContent = formatPercent(percent);
		}
		/**
		* Drag the pitch fader.
		*
		* Sends on every move rather than on release, because a pitch fader is a
		* continuous control — hearing the record bend as you push it IS the feature,
		* and a value that only landed on mouse-up would be a slider pretending to be a
		* fader. The host clamps, and identical values are dropped so a jittery pointer
		* can't spam the engine.
		*
		* Pointer capture on the element, as everywhere else here: the sandbox exposes
		* no ambient `window`, so window-level drag listeners are impossible — and
		* capture is the better primitive anyway.
		*/
		function onPitchDown(e) {
			if (e.button !== 0 || typeof host.actions.setRate !== "function") return;
			e.preventDefault();
			e.stopPropagation();
			const target = e.currentTarget;
			const basis = decomposeRate(rate).basis;
			let lastSent = rate;
			scrubbingPitch = true;
			target.setPointerCapture?.(e.pointerId);
			const move = (ev) => {
				const r = target.getBoundingClientRect();
				if (r.height <= 0) return;
				const percent = travelToPercent((ev.clientY - r.top) / r.height);
				showPitch(percent);
				const next = composeRate(basis, percent);
				if (Math.abs(next - lastSent) > 5e-4) {
					lastSent = next;
					setRate(next);
				}
			};
			const up = () => {
				scrubbingPitch = false;
				target.removeEventListener("pointermove", move);
				target.removeEventListener("pointerup", up);
				target.removeEventListener("pointercancel", up);
			};
			target.addEventListener("pointermove", move);
			target.addEventListener("pointerup", up);
			target.addEventListener("pointercancel", up);
			move(e);
		}
		return {
			mount(h) {
				host = h;
				root = h.root;
				size = h.size;
				doc = root.ownerDocument;
				const style = doc.createElement("style");
				style.textContent = DECK_CSS;
				root.append(style);
				deck = doc.createElement("div");
				deck.className = `deck lifted skin-${cfg.name}`;
				deck.innerHTML = (cfg.furniture ? PLINTH_HTML : "") + "<div class=\"platter\">" + (cfg.furniture ? "<div class=\"rim\"><i class=\"dots\"></i></div>" : "") + "<div class=\"body\"></div><div class=\"spin\"><canvas></canvas><div class=\"shimmer\"></div><div class=\"label\"></div></div><div class=\"sheen\"></div><div class=\"iris\"></div><div class=\"hole\"></div><div class=\"lever\"><i></i></div><div class=\"armwrap\"><div class=\"armrise\"><div class=\"arm\"><div class=\"armlift\"><div class=\"counter\"></div><div class=\"pivot\"></div><div class=\"tube\"></div>" + (cfg.furniture ? SARM_SVG : "") + "<div class=\"shadow\"></div><div class=\"head\"></div></div></div></div></div></div>";
				root.append(deck);
				platter = deck.querySelector(".platter");
				spin = deck.querySelector(".spin");
				canvas = deck.querySelector("canvas");
				label = deck.querySelector(".label");
				arm = deck.querySelector(".arm");
				lever = deck.querySelector(".lever");
				deck.querySelector(".head").addEventListener("pointerdown", onDown);
				lever.addEventListener("click", toggleTransport);
				deck.querySelector(".start")?.addEventListener("click", () => {
					if (typeof host.actions.setPlaying !== "function") return;
					if (playing) motorStopped = true;
					host.actions.setPlaying(!playing);
				});
				dots = deck.querySelector(".dots");
				s33 = deck.querySelector(".s33");
				s45 = deck.querySelector(".s45");
				s33?.addEventListener("click", () => setRate(composeRate(1, decomposeRate(rate).percent)));
				s45?.addEventListener("click", () => setRate(composeRate(RATE_45, decomposeRate(rate).percent)));
				pitch = deck.querySelector(".pitch");
				pval = deck.querySelector(".pval");
				pitch?.addEventListener("pointerdown", onPitchDown);
				deck.querySelector(".reset")?.addEventListener("click", () => {
					setRate(decomposeRate(rate).basis);
				});
				unsubs.push(h.onResize((s) => {
					size = s;
					lastRevision = -1;
				}));
				unsubs.push(h.onSkinChange(() => {}));
			},
			frame(state) {
				playing = state.playing;
				rate = typeof state.rate === "number" && state.rate > 0 ? state.rate : 1;
				if (state.queueRevision !== lastRevision) {
					lastRevision = state.queueRevision;
					repress(state.queue);
				}
				if (bands.length === 0) return;
				currentIndex = state.currentIndex;
				const art = state.queue[state.currentIndex]?.artUrl ?? null;
				if (art !== lastArt) {
					lastArt = art;
					label.style.backgroundImage = art ? `url("${art}")` : "";
				}
				if (!dragging) {
					const idx = Math.max(0, Math.min(bands.length - 1, state.currentIndex));
					const r = positionToRadius(bands, idx, state.positionSecs, geo);
					arm.style.setProperty("--deg", `${armAngleDeg(r, geo, mountPoint).toFixed(2)}deg`);
				}
				if (state.playing && !wasPlaying) motorStopped = false;
				wasPlaying = state.playing;
				deck.classList.toggle("lifted", !state.playing && !motorStopped);
				deck.classList.toggle("motor-off", motorStopped);
				const pitchState = decomposeRate(rate);
				if (s33) s33.classList.toggle("on", pitchState.basis === 1);
				if (s45) s45.classList.toggle("on", pitchState.basis !== 1);
				if (!scrubbingPitch) showPitch(pitchState.percent);
				deck.classList.toggle("off-speed", Math.abs(pitchState.percent) > .05);
				if (!host.reducedMotion) {
					const dt = lastMs === null ? 0 : Math.max(0, Math.min(250, state.timeMs - lastMs));
					const target = motorStopped ? 0 : rate;
					const tau = target === 0 ? BRAKE_TAU_MS : SPINUP_TAU_MS;
					spinVel += (target - spinVel) * (1 - Math.exp(-dt / tau));
					if (Math.abs(target - spinVel) < .001) spinVel = target;
					spinAngle = (spinAngle + dt / 1800 * 360 * spinVel) % 360;
					spin.style.transform = `rotate(${spinAngle}deg)`;
					if (dots) {
						const reference = spinVel > .05 ? 1 : 0;
						dotAngle = (dotAngle + dt / 1800 * 360 * (spinVel - reference)) % 360;
						dots.style.transform = `rotate(${dotAngle}deg)`;
					}
				}
				lastMs = state.timeMs;
			},
			destroy() {
				for (const u of unsubs) try {
					u();
				} catch {}
				unsubs.length = 0;
			}
		};
	}
	//#endregion
	//#region src/index.ts
	function activate(api) {
		api.visualizers.onMount("deck", () => createVinylDeckVisualizer("studio"));
		api.visualizers.onMount("sl1200", () => createVinylDeckVisualizer("sl1200"));
	}
	function deactivate() {}
	//#endregion
	exports.activate = activate;
	exports.deactivate = deactivate;
	return exports;
})({});
return __viboplrPlugin;
