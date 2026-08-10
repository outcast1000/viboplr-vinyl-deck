var __viboplrPlugin = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/sounds.ts
	/**
	* The switch list, in the order a settings panel should show it: the continuous
	* beds, then the needle, then the controls. Labels live here so the harness and
	* the eventual settings panel cannot disagree about what a voice is called.
	*/
	var VOICES = [
		{
			id: "motor",
			label: "Platter motor",
			hint: "Rumble and the spin-up / spin-down sag"
		},
		{
			id: "hiss",
			label: "Groove hiss",
			hint: "Surface noise while the needle is down"
		},
		{
			id: "crackle",
			label: "Crackle",
			hint: "Occasional pops"
		},
		{
			id: "drop",
			label: "Needle drop",
			hint: "The stylus meeting the groove"
		},
		{
			id: "lift",
			label: "Cue lift",
			hint: "The lever taking it off again"
		},
		{
			id: "scrape",
			label: "Cue scrape",
			hint: "Dragging the headshell across a turning record"
		},
		{
			id: "band",
			label: "Track ticks",
			hint: "Crossing the land between tracks"
		},
		{
			id: "runout",
			label: "Run-out",
			hint: "The tick at the end of the pressing"
		},
		{
			id: "transport",
			label: "START/STOP",
			hint: "The transport switch"
		},
		{
			id: "speed",
			label: "33 / 45 buttons",
			hint: "The speed switches"
		},
		{
			id: "detent",
			label: "Pitch detent",
			hint: "The click at 0%"
		}
	];
	/**
	* Is this voice on?
	*
	* ABSENT MEANS ON, which is what makes adding a twelfth noise later a one-line
	* change instead of a migration: stored settings written before it existed
	* simply don't mention it. The master switch is still the gate above it, so
	* "on" here only ever means "not individually silenced".
	*/
	function voiceOn(s, id) {
		return s.enabled && s.voices[id] !== false;
	}
	var DEFAULT_SOUND_SETTINGS = {
		enabled: false,
		level: .5,
		voices: {
			hiss: false,
			crackle: false
		}
	};
	/**
	* The rumble bed, as a function of platter velocity (1 = 33⅓).
	*
	* The tone's pitch is proportional to velocity and nothing else, which is the
	* whole spin-down effect: as the brake takes hold the pitch sags to nothing.
	* That is what a slowing record sounds like, and it falls out of the deck's
	* existing eased `spinVel` for free — no envelope to hand-author, and a
	* spin-down interrupted halfway by START sounds right without a special case.
	*
	* Gain rises faster than linearly so a platter creeping at 5% is inaudible
	* rather than a quiet hum that never quite stops.
	*/
	function rumbleParams(vel) {
		const v = Math.max(0, Math.min(2, vel));
		return {
			cutoffHz: 35 + 80 * v,
			toneHz: 74 * v,
			gain: .065 * v * v
		};
	}
	/**
	* The motor tone's level.
	*
	* Held well under the rumble's: a pitched component is far more noticeable than
	* broadband noise at equal gain, and this one runs continuously under music the
	* user chose. Loud enough to sag audibly when the brake bites, and no louder.
	*/
	var TONE_GAIN = .013;
	/**
	* Groove hiss level. Silent unless the needle is actually in the groove AND the
	* record is turning — a stylus resting on a stopped record makes no noise, which
	* is the difference between the cue lever and START/STOP that the deck spends so
	* much effort keeping distinct.
	*/
	function surfaceGain(vel, needleDown) {
		if (!needleDown) return 0;
		return .055 * Math.max(0, Math.min(1.5, vel));
	}
	/**
	* Pops per second. Scaled by velocity for the same reason as the hiss, and kept
	* deliberately sparse: crackle reads as "a record" at a few per second and as a
	* fault above that.
	*/
	function crackleRate(vel, needleDown) {
		if (!needleDown) return 0;
		return 3.5 * Math.max(0, Math.min(1.5, vel));
	}
	/**
	* The cue scrape, from the drag speed in px/sec.
	*
	* Both terms saturate. A hand can flick the headshell faster than any real
	* stylus could survive, and without a ceiling the sound would keep getting
	* louder and brighter past anything a record does.
	*/
	function scrapeParams(speedPxPerSec) {
		const s = Math.max(0, speedPxPerSec);
		return {
			gain: Math.min(.22, s / 4e3),
			centerHz: 260 + Math.min(1400, s * 1.6)
		};
	}
	/**
	* Every switch on the deck is the same gesture with a different mass behind it,
	* so they are one spec table rather than five functions. START/STOP is a big
	* stiff switch with a plinth behind it; the speed buttons are small and dry; the
	* fader detent is a tiny sprung ball; the band tick and the run-out are the
	* stylus crossing land, which is not a switch at all and so is quieter and
	* duller than any of them.
	*/
	var CLICKS = {
		transport: {
			centerHz: 1900,
			q: 1.1,
			durMs: 16,
			gain: .3,
			thumpHz: 92
		},
		speed: {
			centerHz: 3100,
			q: 1.6,
			durMs: 9,
			gain: .2
		},
		detent: {
			centerHz: 4800,
			q: 2.4,
			durMs: 6,
			gain: .13
		},
		band: {
			centerHz: 1700,
			q: 1.8,
			durMs: 7,
			gain: .1
		},
		runout: {
			centerHz: 1150,
			q: 1.5,
			durMs: 11,
			gain: .14
		}
	};
	/** The silent object. Same shape, no context, no cost. */
	function silentSounds() {
		return {
			setSettings() {},
			frame() {},
			drop() {},
			lift() {},
			click() {},
			scrape() {},
			endScrape() {},
			destroy() {}
		};
	}
	/** Two seconds of white noise, generated once and shared by every voice. */
	function noiseBuffer(ctx) {
		const len = Math.floor(ctx.sampleRate * 2);
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
		return buf;
	}
	function createDeckSounds(out, initial = {}) {
		if (!out) return silentSounds();
		const ctx = out.context;
		let settings = {
			...DEFAULT_SOUND_SETTINGS,
			...initial,
			voices: {
				...DEFAULT_SOUND_SETTINGS.voices,
				...initial.voices ?? {}
			}
		};
		let destroyed = false;
		const noise = noiseBuffer(ctx);
		const master = ctx.createGain();
		master.gain.value = 0;
		master.connect(out.destination);
		const rumbleSrc = ctx.createBufferSource();
		rumbleSrc.buffer = noise;
		rumbleSrc.loop = true;
		const rumbleFilter = ctx.createBiquadFilter();
		rumbleFilter.type = "lowpass";
		const rumbleGain = ctx.createGain();
		rumbleGain.gain.value = 0;
		rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(master);
		rumbleSrc.start();
		const tone = ctx.createOscillator();
		tone.type = "triangle";
		tone.frequency.value = 0;
		const toneGain = ctx.createGain();
		toneGain.gain.value = 0;
		tone.connect(toneGain).connect(master);
		tone.start();
		const hissSrc = ctx.createBufferSource();
		hissSrc.buffer = noise;
		hissSrc.loop = true;
		const hissFilter = ctx.createBiquadFilter();
		hissFilter.type = "highpass";
		hissFilter.frequency.value = 1400;
		const hissGain = ctx.createGain();
		hissGain.gain.value = 0;
		hissSrc.connect(hissFilter).connect(hissGain).connect(master);
		hissSrc.start();
		const scrapeSrc = ctx.createBufferSource();
		scrapeSrc.buffer = noise;
		scrapeSrc.loop = true;
		const scrapeFilter = ctx.createBiquadFilter();
		scrapeFilter.type = "bandpass";
		scrapeFilter.Q.value = .9;
		scrapeFilter.frequency.value = 400;
		const scrapeGain = ctx.createGain();
		scrapeGain.gain.value = 0;
		scrapeSrc.connect(scrapeFilter).connect(scrapeGain).connect(master);
		scrapeSrc.start();
		/** Short ramp to a target — `setTargetAtTime` never quite arrives, and a
		*  bed that never quite reaches zero is a bed that hisses forever. */
		function ramp(p, to, secs = .04) {
			const t = ctx.currentTime;
			p.cancelScheduledValues(t);
			p.setValueAtTime(p.value, t);
			p.linearRampToValueAtTime(to, t + secs);
		}
		function applyMaster() {
			ramp(master.gain, settings.enabled ? Math.max(0, Math.min(1, settings.level)) : 0, .08);
		}
		applyMaster();
		/**
		* A filtered noise burst — the shape every one-shot here is made of.
		*
		* Built per trigger and left to be collected: these are milliseconds long and
		* a pool would be more machinery than the thing it manages.
		*/
		function burst(o) {
			if (destroyed || !settings.enabled) return;
			const t = ctx.currentTime;
			const dur = o.durMs / 1e3;
			const src = ctx.createBufferSource();
			src.buffer = noise;
			const off = Math.random() * (noise.duration - dur - .01);
			const f = ctx.createBiquadFilter();
			f.type = o.type ?? "bandpass";
			f.frequency.setValueAtTime(o.centerHz, t);
			if (o.sweepToHz !== void 0) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepToHz), t + dur);
			f.Q.value = o.q;
			const g = ctx.createGain();
			g.gain.setValueAtTime(o.gain, t);
			g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
			src.connect(f).connect(g).connect(master);
			src.start(t, Math.max(0, off), dur + .02);
			src.onended = () => {
				src.disconnect();
				f.disconnect();
				g.disconnect();
			};
		}
		/** A sine thump with a fast decay — the body under a drop or a big switch. */
		function thump(freq, durMs, gain) {
			if (destroyed || !settings.enabled) return;
			const t = ctx.currentTime;
			const dur = durMs / 1e3;
			const osc = ctx.createOscillator();
			osc.type = "sine";
			osc.frequency.setValueAtTime(freq, t);
			osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * .55), t + dur);
			const g = ctx.createGain();
			g.gain.setValueAtTime(gain, t);
			g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
			osc.connect(g).connect(master);
			osc.start(t);
			osc.stop(t + dur + .02);
			osc.onended = () => {
				osc.disconnect();
				g.disconnect();
			};
		}
		let lastFrameAt = null;
		return {
			setSettings(s) {
				settings = {
					...settings,
					...s,
					voices: {
						...settings.voices,
						...s.voices ?? {}
					}
				};
				applyMaster();
				if (!voiceOn(settings, "hiss")) ramp(hissGain.gain, 0, .1);
				if (!voiceOn(settings, "scrape")) ramp(scrapeGain.gain, 0, .1);
				if (!voiceOn(settings, "motor")) {
					ramp(rumbleGain.gain, 0, .1);
					ramp(toneGain.gain, 0, .1);
				}
			},
			frame(vel, needleDown) {
				if (destroyed) return;
				const now = ctx.currentTime;
				const dt = lastFrameAt === null ? 0 : Math.max(0, Math.min(.25, now - lastFrameAt));
				lastFrameAt = now;
				if (!settings.enabled) return;
				if (voiceOn(settings, "motor")) {
					const r = rumbleParams(vel);
					rumbleFilter.frequency.value = r.cutoffHz;
					rumbleGain.gain.value = r.gain;
					tone.frequency.value = r.toneHz;
					toneGain.gain.value = r.toneHz > 1 ? TONE_GAIN : 0;
				}
				hissGain.gain.value = voiceOn(settings, "hiss") ? surfaceGain(vel, needleDown) : 0;
				if (voiceOn(settings, "crackle")) {
					const rate = crackleRate(vel, needleDown);
					if (rate > 0 && Math.random() < rate * dt) burst({
						centerHz: 1400 + Math.random() * 2600,
						q: 2.2,
						durMs: 4 + Math.random() * 6,
						gain: .02 + Math.random() * .09
					});
				}
			},
			drop() {
				if (!voiceOn(settings, "drop")) return;
				thump(74, 130, .26);
				burst({
					centerHz: 1500,
					q: .7,
					durMs: 95,
					gain: .3,
					type: "lowpass",
					sweepToHz: 190
				});
			},
			lift() {
				if (!voiceOn(settings, "lift")) return;
				burst({
					centerHz: 900,
					q: .9,
					durMs: 55,
					gain: .17,
					sweepToHz: 1700
				});
			},
			click(kind) {
				if (!voiceOn(settings, kind)) return;
				const c = CLICKS[kind];
				burst({
					centerHz: c.centerHz,
					q: c.q,
					durMs: c.durMs,
					gain: c.gain
				});
				if (c.thumpHz) thump(c.thumpHz, 55, .14);
			},
			scrape(speedPxPerSec) {
				if (destroyed) return;
				if (!voiceOn(settings, "scrape")) {
					ramp(scrapeGain.gain, 0, .05);
					return;
				}
				const p = scrapeParams(speedPxPerSec);
				scrapeFilter.frequency.value = p.centerHz;
				ramp(scrapeGain.gain, p.gain, .02);
			},
			endScrape() {
				if (destroyed) return;
				ramp(scrapeGain.gain, 0, .08);
			},
			destroy() {
				if (destroyed) return;
				destroyed = true;
				for (const s of [
					rumbleSrc,
					hissSrc,
					scrapeSrc
				]) try {
					s.stop();
				} catch {}
				try {
					tone.stop();
				} catch {}
				master.disconnect();
			}
		};
	}
	/**
	* A deck's sound engine, built only once it could actually be heard.
	*
	* WHY THIS EXISTS. Sounds are **off by default** (see `DEFAULT_SOUND_SETTINGS`),
	* but the engine used to be constructed at mount regardless — and constructing it
	* means reading the host's audio destination, which is what *opens the device*.
	* The host builds that `AudioContext` on first read precisely so a visualizer
	* that never makes a noise never opens one; reading it unconditionally defeated
	* that. The cost isn't theoretical: an open context is a render thread waking
	* every ~2.7ms, and the four continuous beds below are always-running sources
	* whose gains are steered to zero rather than stopped — so a silent deck was
	* still processing an audio graph on every quantum, and (since the host's bus is
	* shared and long-lived) left the device open behind it.
	*
	* `resolveOut` is therefore called **lazily**, on the first settings that turn
	* sounds on. That's not a deferral of a few frames — for a user who never enables
	* sounds it is never called at all.
	*
	* The switch-on path is covered because `registerDeckSounds` pushes the current
	* settings into every live engine: a deck mounted with sounds already on builds
	* immediately, and one mounted with them off builds the moment the panel turns
	* them on. Nothing else needs to know the engine was late.
	*/
	function createLazyDeckSounds(resolveOut) {
		let real = null;
		let destroyed = false;
		let settings = {
			...DEFAULT_SOUND_SETTINGS,
			voices: { ...DEFAULT_SOUND_SETTINGS.voices }
		};
		/**
		* The engine, or null while there is nothing to hear.
		*
		* Built with the settings it will start under rather than the defaults, so it
		* never opens at one level and corrects itself a frame later.
		*/
		function engine() {
			if (real || destroyed || !settings.enabled) return real;
			real = createDeckSounds(resolveOut(), settings);
			return real;
		}
		return {
			setSettings(s) {
				settings = {
					...settings,
					...s,
					voices: {
						...settings.voices,
						...s.voices ?? {}
					}
				};
				if (real) real.setSettings(settings);
				else engine();
			},
			frame(vel, needleDown) {
				real?.frame(vel, needleDown);
			},
			drop() {
				real?.drop();
			},
			lift() {
				real?.lift();
			},
			click(kind) {
				real?.click(kind);
			},
			scrape(speedPxPerSec) {
				real?.scrape(speedPxPerSec);
			},
			endScrape() {
				real?.endScrape();
			},
			destroy() {
				destroyed = true;
				real?.destroy();
				real = null;
			}
		};
	}
	//#endregion
	//#region src/soundSettings.ts
	var current = {
		...DEFAULT_SOUND_SETTINGS,
		voices: { ...DEFAULT_SOUND_SETTINGS.voices }
	};
	var live = /* @__PURE__ */ new Set();
	function deckSoundSettings() {
		return current;
	}
	/**
	* Apply a change everywhere at once.
	*
	* Merges rather than replaces `voices`, so a panel toggling one checkbox does
	* not have to send the other ten back — and so a stored object written before a
	* voice existed cannot silence it by omission.
	*/
	function setDeckSoundSettings(patch) {
		current = {
			...current,
			...patch,
			voices: {
				...current.voices,
				...patch.voices ?? {}
			}
		};
		for (const s of live) s.setSettings(current);
		return current;
	}
	/**
	* Register a mounted deck's sound engine. Returns an unsubscriber for destroy().
	*
	* Applies the current settings immediately: a deck mounted after the user has
	* been through the panel must not start at the defaults and correct itself on
	* the first change.
	*/
	function registerDeckSounds(s) {
		live.add(s);
		s.setSettings(current);
		return () => {
			live.delete(s);
		};
	}
	//#endregion
	//#region src/settingsPanel.ts
	var PANEL_ID = "vinyl-deck-sounds";
	var STORAGE_KEY = "sounds";
	/** `toggle` actions are addressed by id, so each voice needs its own. */
	function voiceActionId(id) {
		return `voice:${id}`;
	}
	var MASTER_ACTION = "sounds:enabled";
	/**
	* The new state carried by a toggle action.
	*
	* The host sends `{ value: !checked }`, NOT a bare boolean — see `PluginToggle`
	* in the app's pluginViews. Reading it as a boolean is silently always false, so
	* every toggle writes "off" and the switch springs back with nothing logged
	* anywhere. That cost a live test to find, which is why it is a named function
	* with this comment on it rather than an inline comparison.
	*/
	function toggleValue(data) {
		return data?.value === true;
	}
	/**
	* The panel, as view nodes.
	*
	* Pure so it can be asserted without a host: this is the only place the switches
	* are named, and a toggle wired to the wrong action id looks identical in a
	* screenshot to one that works.
	*/
	function buildSoundPanel(s) {
		return {
			type: "section",
			title: "Sounds",
			children: [{
				type: "toggle",
				label: "Deck sounds",
				description: "The turntable's own noises — the motor, the needle, the switches. They play over your music, at your app volume.",
				action: MASTER_ACTION,
				checked: s.enabled
			}, ...VOICES.map((v) => ({
				type: "toggle",
				label: v.label,
				description: v.hint,
				action: voiceActionId(v.id),
				checked: s.enabled && s.voices[v.id] !== false
			}))]
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
	function installSoundPanel(api) {
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
		for (const voice of VOICES) api.ui.onAction(voiceActionId(voice.id), (data) => {
			setDeckSoundSettings({ voices: { [voice.id]: toggleValue(data) } });
			render();
			persist();
		});
		render();
		api.storage.get(STORAGE_KEY).then((stored) => {
			if (!stored) return;
			setDeckSoundSettings({
				enabled: stored.enabled === true,
				voices: stored.voices ?? {}
			});
			render();
		}).catch((e) => console.error("Failed to load vinyl deck sound settings:", e));
	}
	//#endregion
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
	*
	* `sideSecs` is what a full side holds, and passing it makes the pressing take
	* only the share of the record its RUNNING TIME earns. Without it the bands are
	* normalised to the queue's own total and always fill the program area, so a
	* three-minute single and a twenty-two-minute side press identically — a record
	* with one short track on it is mostly blank vinyl, and drawing it full is
	* drawing the wrong object. Omitted (or non-positive) keeps the fill-everything
	* behaviour, which is still right when nothing has a usable duration and the
	* proportions are invented anyway.
	*/
	function layoutBands(durations, geo, sideSecs) {
		const n = durations.length;
		if (n === 0) return [];
		const safe = durations.map((d) => typeof d === "number" && Number.isFinite(d) && d > 0 ? d : 0);
		const total = safe.reduce((s, d) => s + d, 0);
		const weights = total > 0 ? safe.map((d) => d / total) : safe.map(() => 1 / n);
		const fill = sideSecs && sideSecs > 0 && total > 0 ? Math.min(1, total / sideSecs) : 1;
		const span = (geo.rLeadIn - geo.rProgIn) * fill;
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
	/**
	* Clamp a radius to the part of the record that actually carries music.
	*
	* Distinct from `clampToProgram`, which clamps to the area a FULL side would
	* occupy. Once a pressing takes only the share its running time earns, those two
	* stop being the same thing: a short side ends well outside the run-out, and
	* clamping to the geometry would let the needle be parked in blank vinyl that no
	* track answers for.
	*
	* Falls back to the program area when there is nothing pressed, so an empty
	* queue behaves as it always did.
	*/
	function clampToPressing(r, bands, geo) {
		if (bands.length === 0) return clampToProgram(r, geo);
		return Math.max(bands[bands.length - 1].inner, Math.min(bands[0].outer, r));
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
	*
	* `pixelScale` raises the BACKING STORE resolution without touching the layout:
	* every coordinate here is still in `geo`'s CSS pixels, and the canvas element's
	* CSS size is set by the caller. It exists for the cue-drag magnifier — CSS-
	* scaling the deck stretches a fixed bitmap, which makes the grooves bigger and
	* blurrier rather than more legible, and the whole point of zooming into a
	* record is to read the waveform pressed into it. Re-rasterising at the zoomed
	* size is what actually shows more.
	*/
	function paintVinylSurface(canvas, geo, bands, peaks, etch, pixelScale = 1) {
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const dpr = Math.min((window.devicePixelRatio || 1) * Math.max(1, pixelScale), 4);
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
		ring(rEdge - .6, 1.2, white(.34));
		ring(rEdge - 2, 1.6, white(.12));
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
		const progEnd = bands.length > 0 ? bands[bands.length - 1].inner : rProgIn;
		ring(progEnd - 1, 1.4, black(.95));
		for (let r = progEnd - 3; r > rDeadWax; r -= 3.2) ring(r, 1, white(.04));
		ring(rLabel + .5, 1, white(.09));
		if (etch) {
			const bandH = rProgIn - rLabel;
			const size = Math.max(4, bandH * .42);
			ctx.font = `600 ${size.toFixed(1)}px system-ui, sans-serif`;
			ctx.textAlign = "center";
			ctx.fillStyle = white(.3);
			ctx.fillText(etch, cx, cy + (rLabel + rProgIn) / 2 + size * .35);
		}
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
			},
			restAt: {
				x: .8,
				y: .82
			}
		}
	};
	/** Unknown names fall back to the plain deck rather than rendering nothing. */
	function skinConfig(skin) {
		return SKINS[skin] ?? STUDIO;
	}
	//#endregion
	//#region src/sides.ts
	/** Playing time a side holds. A 12" LP at 33⅓ is about 22 minutes. */
	var SIDE_SECS = 1320;
	/** Durations are optional and often unknown; an unknown one buys no time. */
	function usable(d) {
		return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : 0;
	}
	/**
	* Cut a queue into sides.
	*
	* A track is never split across sides — one longer than a whole side simply gets
	* a side to itself, which is what a pressing plant would do too.
	*
	* Tracks with no duration contribute nothing to the time budget rather than an
	* invented nominal: the count cap is already the right answer for "we can't tell
	* how long these are", so there's no need to guess a number that would then be
	* wrong in a specific way.
	*/
	function splitSides(durations, sideSecs = SIDE_SECS, maxTracks = 14) {
		const n = durations.length;
		if (n === 0) return [];
		const sides = [];
		let start = 0;
		let secs = 0;
		let count = 0;
		for (let i = 0; i < n; i++) {
			const d = usable(durations[i]);
			if (count > 0 && (secs + d > sideSecs || count >= maxTracks)) {
				sides.push({
					index: sides.length,
					start,
					count,
					secs,
					of: 0
				});
				start = i;
				secs = 0;
				count = 0;
			}
			secs += d;
			count++;
		}
		sides.push({
			index: sides.length,
			start,
			count,
			secs,
			of: 0
		});
		for (const s of sides) s.of = sides.length;
		return sides;
	}
	/**
	* The side holding a queue index.
	*
	* Out-of-range clamps rather than returning null: a non-empty queue always has a
	* side to show, and `currentIndex` is legitimately -1 before anything plays.
	*/
	function sideAt(sides, queueIndex) {
		if (sides.length === 0) return null;
		const i = Math.floor(queueIndex);
		if (!(i > 0)) return sides[0];
		for (let s = sides.length - 1; s >= 0; s--) if (i >= sides[s].start) return sides[s];
		return sides[0];
	}
	/**
	* What to etch in the dead wax, or null when the queue fits one side.
	*
	* A single-side queue is just a record; "SIDE 1 OF 1" on it would be noise. The
	* label only earns its place once there is somewhere else to be.
	*/
	function sideLabel(side) {
		if (!side || side.of <= 1) return null;
		return `SIDE ${side.index + 1} OF ${side.of}`;
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
	/**
	* How far the deck magnifies while the headshell is being dragged.
	*
	* Chosen against the thing it exists to make readable. The painter lays grooves
	* at a 1.15px pitch, so at 1x a band on a full twelve-track side is a handful of
	* groove rings and its waveform texture is a suggestion; at 2.2x it is a dozen
	* or so with visibly varying brightness, which is the difference between aiming
	* at a track and aiming at a smudge.
	*
	* Not higher, because the loupe is anchored where you grabbed and the rest of the
	* record has to stay recognisable around it — past roughly this the band you are
	* leaving and the one you are heading for are both off-screen, and a cue you
	* cannot aim in context is no easier than one you cannot see.
	*/
	var CUE_ZOOM = 2.2;
	/** Plinth furniture. Decorative except for START/STOP and the speed buttons. */
	var PLINTH_HTML = "<div class=\"plinth\"><div class=\"adaptor\"></div><div class=\"target\"></div><div class=\"power\"></div><button class=\"start\" type=\"button\">start &#183; stop</button><div class=\"speeds\"><button class=\"s33\" type=\"button\" aria-label=\"33 rpm\">33</button><button class=\"s45\" type=\"button\" aria-label=\"45 rpm\">45</button></div><div class=\"pscale\">" + [
		"8",
		"6",
		"4",
		"2",
		"0",
		"2",
		"4",
		"6",
		"8"
	].map((n, i) => `<span style="top:${(i * 12.5).toFixed(1)}%">${n}</span>`).join("") + "</div><div class=\"pitch\"><span class=\"pmark pminus\">&#8722;</span><span class=\"pmark pplus\">+</span><i></i></div><div class=\"pval\"></div><button class=\"reset\" type=\"button\" aria-label=\"Reset pitch\"></button><div class=\"rest\"></div><div class=\"foot\"></div><div class=\"brand\"><b>Viboplr</b><span>Direct Drive Turntable System</span></div></div>";
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
		let stage;
		let cueRing;
		let cueReadout;
		let platter;
		let spin;
		let canvas;
		let label;
		let arm;
		let lever;
		let rest = null;
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
		/** Last `rate` seen in frame(). Drives the platter's speed, the strobe drift
		*  and which speed button is lit. */
		let rate = 1;
		/**
		* THE DECK'S OWN STATE, and the reason it needs any.
		*
		* A turntable has three independent mechanisms, and each one alone is enough to
		* stop the sound:
		*
		*   motorOff  START/STOP. Brakes the platter. Touches nothing else — in
		*             particular it does NOT lift the arm, which stays in its groove
		*             over a record that is no longer turning.
		*   armUp     The cue lever. Raises the stylus off the record where it stands,
		*             leaving the platter spinning and the arm over its groove.
		*   parked    The arm returned to its rest, clear of the platter. Only a full
		*             stop does this.
		*
		* The host has one `playing` flag and one `stopped` flag, which is enough to
		* drive all three (see frame()) but not to *be* all three: nothing in the host
		* knows whether a pause came from the lever or the motor, because on the host's
		* side there is no such distinction. So this is genuinely the deck's own state,
		* and the only state it keeps.
		*
		* THE INVARIANT, in both directions:
		*   host playing  ==  !motorOff && !armUp
		* Every control here asks for exactly that (see `syncTransport`), and every
		* frame reconciles back to it. A deck that is stopped or lifted while the music
		* plays is a deck drawing a lie.
		*/
		let motorOff = false;
		let armUp = false;
		let parked = false;
		/** Previous frame's `playing`, so the flags can be cleared on the rising edge
		*  rather than the level. See frame(). */
		let wasPlaying = false;
		/** Previous frame's `stopped`, for the same reason — a stop parks the arm once
		*  rather than pinning every mechanism for as long as the host stays stopped.
		*  See the stop branch in frame(). */
		let wasStopped = false;
		/**
		* The deck has asked for playback and the host hasn't answered yet.
		*
		* `setPlaying` is asynchronous from here, so a request to PLAY is followed by
		* frames that still report paused. Without this the reconciler reads those as
		* "silent with the motor running and the arm down — something outside must have
		* raised the lever" and pops the arm up, one frame after the user pressed START
		* to lower it. The flag says: this silence is mine, I'm waiting on it.
		*
		* Only ever set for a request that both mechanisms agree on, and cleared the
		* moment the host resolves it either way.
		*/
		let pendingPlay = false;
		/**
		* A cue changed track on a deck that was not running, and the play it implied
		* is being undone.
		*
		* `playQueueIndex` is the contract's only way to change track and it always
		* starts playback, so cueing a paused or stopped deck to a different band would
		* otherwise start the music and — via the rising edge in frame() — drop the arm
		* and clear the motor. Moving the arm is not pressing play: on the desk you cue
		* a stopped deck constantly and it stays stopped.
		*
		* While set, the rising edge is ignored (the sound is this deck's own doing, not
		* an instruction) and the transport is re-asserted until the host agrees. It
		* clears the moment the host reports paused, so it can never latch.
		*/
		let restoringCue = false;
		/**
		* The deck's noises, and the state they are derived from.
		*
		* DERIVED FROM THE MECHANISMS, NOT FROM THE INPUTS. The obvious wiring is a
		* sound per click handler, and it is wrong: `armUp` and `motorOff` are also
		* set by frame()'s reconciler, which is how the deck answers a pause from the
		* spacebar or the now-playing bar. Hang the drop off the lever's own click and
		* the arm would come down silently whenever the music was resumed from
		* anywhere else — the picture would move and the sound would not. Comparing
		* the flags frame to frame catches every route into a mechanism, including the
		* ones that have no click at all.
		*
		* Silent until a host grants audio; see `sounds.ts` on why the context is
		* handed in rather than constructed.
		*/
		let sounds = createDeckSounds(null);
		let unregisterSounds = null;
		let sndArmUp = null;
		let sndMotorOff = null;
		let sndIndex = null;
		/**
		* A cue moved a RUNNING deck to another band, and the play that goes with it is
		* still owed.
		*
		* The mirror image of `restoringCue`: that one takes back a play the contract
		* forced, this one supplies a play the contract deferred. `loadQueueIndex` is
		* the only write that can change track and carry a position, and it
		* deliberately does not start anything — so a running deck has to ask for the
		* transport separately, and cannot do it in the same tick.
		*
		* WHY NOT IMMEDIATELY: the host's `setPlaying` bridge drops a request that
		* matches its own live state, and at pointerup that state still says playing —
		* the load has not re-rendered yet. The request would be swallowed and the deck
		* would stand there, arm down, in silence. So the ask waits for the frame where
		* the host actually reports paused, which is the first frame it can be heard.
		*/
		let resumingCue = false;
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
		/**
		* Arm rotation that lays the head on the tonearm rest, or null for a livery
		* that has no rest.
		*
		* Derived in repress() from the SAME `cfg.restAt` that positions the post, so
		* the two cannot disagree. Null everywhere it can't be used: only a deck with
		* furniture has a START/STOP, and START/STOP is the only thing that parks.
		*/
		let restDeg = null;
		let lastRevision = -1;
		/**
		* The last value written to each per-frame DOM property, so a frame that
		* changes nothing costs nothing.
		*
		* frame() runs as often as the host drives it — 60fps on a current host, and
		* the display's full refresh rate (120Hz here) on one from before it capped the
		* loop — while almost nothing it writes changes that often. Playback position
		* advances about four times a second, the speed lamps and the transport classes
		* go whole songs without moving, and the strobe ring is stationary at 33 by
		* design. Measured on the SL-1200 livery over two seconds of uncapped playback:
		* 480 setProperty, 480 transform and 1200 classList.toggle calls, of which only
		* the platter's own rotation genuinely had to happen.
		*
		* Writing a style property is not free even when the value is identical: it
		* goes through the CSSOM, dirties the element, and invites a style recalc. So
		* every per-frame write goes through `styleVar` / `styleTransform` / `cssClass`
		* below and is skipped when it would be a no-op.
		*
		* These caches assume nothing else writes the same properties. Nothing does —
		* repress() writes different ones, and the drag paths write `--deg` through the
		* same helper.
		*/
		let wroteDeg = "";
		let wroteSpin = "";
		let wroteDots = "";
		let wroteTravel = "";
		let wrotePval = "";
		let wroteLifted = null;
		let wroteMotorOff = null;
		/** "No record on the platter" — see the empty branch in frame(). */
		let wroteEmpty = null;
		let wroteOffSpeed = null;
		let wroteS33 = null;
		let wroteS45 = null;
		/**
		* The side currently pressed onto the record, and nothing else.
		*
		* A long queue can't go on one side: past ~15 bands the pressing stops being
		* legible and past ~20 the band is thinner than the land between bands, at
		* which point a band is too thin to aim a cue drag at. See sides.ts.
		*
		* Everything below works in SIDE-RELATIVE indices — bands, the arm angle, the
		* cue result — and converts at the two host boundaries by adding side.start.
		*/
		let side = null;
		/** Side start of the last pressing, so crossing a boundary re-presses. */
		let lastSideStart = -1;
		/**
		* The queue cut into sides, recomputed only when the queue itself changes.
		*
		* Cached rather than derived per frame because the cut depends on every
		* duration in the queue, while the only thing that changes between frames is
		* which of these sides we are on.
		*/
		let sides = [];
		let lastArt = null;
		let currentIndex = -1;
		const unsubs = [];
		/**
		* What the last pressing painted, so the magnifier can re-rasterise it at a
		* higher resolution without re-running the layout.
		*
		* Re-pressing to repaint would work and would be wrong: `repress` recomputes
		* the geometry, the bands and the arm mount, and a cue drag must not be able
		* to move the pressing it is aiming at.
		*/
		let lastPeaks = [];
		let lastEtch = null;
		/** Titles of the tracks on the pressed side, for the cue readout. Side-relative,
		*  like `bands`, so the two are indexed by the same number. */
		let lastTitles = [];
		/** Backing-store scale the canvas was last painted at. */
		let paintedScale = 1;
		function styleVar(el, prop, value, last) {
			if (value !== last) el.style.setProperty(prop, value);
			return value;
		}
		function styleTransform(el, value, last) {
			if (value !== last) el.style.transform = value;
			return value;
		}
		function cssClass(el, name, on, last) {
			if (on !== last) el.classList.toggle(name, on);
			return on;
		}
		/** Lay out and repaint. Called on a queue or size change — never per frame. */
		function repress(tracks) {
			const onSide = side ? tracks.slice(side.start, side.start + side.count) : tracks;
			const durations = onSide.map((t) => t.durationSecs);
			const box = Math.max(40, Math.min(size.width, size.height));
			const plinthW = box;
			const plinthH = box / cfg.aspect;
			geo = buildGeometry(Math.max(40, plinthW * cfg.platterScale));
			mountPoint = buildArmMount(geo, cfg.arm);
			bands = layoutBands(durations, geo, SIDE_SECS);
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
			const platterLeft = (plinthW - geo.size) / 2 + cfg.offsetX * plinthW;
			const platterTop = (plinthH - geo.size) / 2 + cfg.offsetY * plinthH;
			if (cfg.leverAt) {
				lever.style.left = `${cfg.leverAt.x * plinthW - platterLeft - leverW / 2}px`;
				lever.style.top = `${cfg.leverAt.y * plinthH - platterTop - leverH / 2}px`;
			} else {
				const diagonal = geo.rEdge * 1.2 * Math.SQRT1_2;
				const inset = 6 * k;
				lever.style.left = `${Math.min(geo.cx + diagonal - leverW / 2, geo.size - leverW - inset)}px`;
				lever.style.top = `${Math.min(geo.cy + diagonal - leverH / 2, geo.size - leverH - inset)}px`;
			}
			if (cfg.restAt && rest) {
				rest.style.left = `${(cfg.restAt.x * 100).toFixed(3)}%`;
				rest.style.top = `${(cfg.restAt.y * 100).toFixed(3)}%`;
				const rx = cfg.restAt.x * plinthW - platterLeft;
				const ry = cfg.restAt.y * plinthH - platterTop;
				restDeg = Math.atan2(ry - mountPoint.py, rx - mountPoint.px) * 180 / Math.PI;
			}
			lastPeaks = onSide.map((t) => t.peaks);
			lastEtch = sideLabel(side);
			lastTitles = onSide.map((t) => t.title);
			paint(1);
		}
		/**
		* Re-rasterise the last pressing at `scale` device pixels per CSS pixel.
		*
		* Separate from repress() because the two answer different questions. A
		* pressing changes WHAT is on the record; this changes only how finely it is
		* drawn, and the cue magnifier must never be able to move the bands it is
		* aiming at.
		*/
		function paint(scale) {
			paintedScale = scale;
			paintVinylSurface(canvas, geo, bands, lastPeaks, lastEtch, scale);
		}
		/** Repaint only if the resolution really changed — a pointermove asks every
		*  frame, and re-rasterising a whole record per frame would drop the drag. */
		function paintAt(scale) {
			if (scale !== paintedScale) paint(scale);
		}
		/**
		* How close to the end of a track a cue may land, in seconds.
		*
		* The innermost groove of a band maps to exactly its duration — which is not a
		* position IN that track, it is the boundary with the next one. Seeking there
		* ends the track on the spot and the queue advances, so dropping the needle at
		* the end of a track skipped it entirely; at the end of a SIDE the advance
		* wrapped, which is the other half of why a drop there landed back at the
		* start. `radiusToPosition` can even come back a hair PAST the duration on the
		* float round-trip (209.00000000000006 for a 209s track), which is the same
		* thing only more certain.
		*
		* A second is well under a pixel of band and inaudible as a difference, but it
		* guarantees the drop lands inside the track that was aimed at.
		*/
		const CUE_END_MARGIN_SECS = 1;
		/**
		* The position a cue should actually target, given where the needle landed.
		*
		* Used by BOTH the seek and the readout, so the number shown is the number
		* committed — a readout promising 3:29 while the seek delivered something else
		* would be worse than showing nothing.
		*/
		function cueTarget(at) {
			const duration = bands[at.index]?.durationSecs ?? 0;
			if (!(duration > 0)) return 0;
			return Math.max(0, Math.min(at.positionSecs, duration - CUE_END_MARGIN_SECS));
		}
		/**
		* mm:ss. Minutes only — a side is 22 minutes, so there is no hour case.
		*
		* ROUNDS rather than floors, unlike an elapsed-time display. This is a target,
		* not a clock: the radius round-trips through the band maths and lands a
		* fraction of a millisecond under, so flooring turns an exact 4:00 into "3:59"
		* — a whole second of apparent error from a rounding artefact, on the one
		* number the user is reading to aim by.
		*/
		function clock(secs) {
			const s = Math.max(0, Math.round(secs));
			return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
		}
		/**
		* Say where the needle is, in the two terms the user is actually choosing in.
		*
		* The ring is the geometric answer — on a record the position IS the radius, so
		* a circle at that radius names the groove exactly, including the part of it
		* hidden under the headshell. The readout is the human one: a radius is not a
		* track name, and "which song, how far in" is the question a cue is really
		* asking. Neither is decoration; without them you are aiming an opaque block at
		* something you cannot see.
		*/
		function showCue(r) {
			cueRing.style.width = `${(r * 2).toFixed(1)}px`;
			cueRing.style.height = `${(r * 2).toFixed(1)}px`;
			const at = radiusToPosition(bands, r);
			if (!at) return;
			const title = lastTitles[at.index] ?? "";
			const n = (side?.start ?? 0) + at.index + 1;
			cueReadout.textContent = `${n}. ${title}  ·  ${clock(cueTarget(at))}`;
		}
		/**
		* Anchor the magnifier on the point being pressed, once, for the whole gesture.
		*
		* THE ANCHOR IS THE PRESS POINT, and that is forced rather than chosen. Under
		* `scale(z)` about origin O a deck point X renders at `z·X + (1−z)·O`, so the
		* point the cursor is over is `X = (R − (1−z)·O) / z` for a cursor at deck
		* position R. Demanding that a stationary cursor keep naming the same groove as
		* z changes — i.e. X = R for all z — gives exactly one solution: O = R. Anchor
		* anywhere else and applying the zoom re-maps the cursor onto a different
		* groove, so the needle slides out from under a hand that has not moved.
		*
		* Anchoring on the STYLUS was the first attempt and it fails twice over. It
		* shifts the needle once when the zoom lands, per the algebra above; and if it
		* is re-aimed each move to follow the needle it becomes a feedback loop, because
		* the stylus is derived from the radius and the radius is measured against the
		* platter as transformed by the anchor. Near the run-out, where the arm's angle
		* changes fastest per unit of radius, that loop diverges — the radius climbs on
		* its own until it clamps at the lead-in, which resolves to track 1 at 0:00. So
		* "let go at the end of the last track" dropped the needle at the start of the
		* side.
		*
		* Read from `deck`, which is never transformed, so this is measurable at any
		* time without the zoom contaminating it.
		*/
		function anchorMagnifier(clientX, clientY) {
			const d = deck.getBoundingClientRect();
			stage.style.transformOrigin = `${(clientX - d.left).toFixed(1)}px ${(clientY - d.top).toFixed(1)}px`;
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
			parked = false;
			anchorMagnifier(e.clientX, e.clientY);
			deck.classList.add("dragging");
			let zoomed = false;
			let lastPt = {
				x: e.clientX,
				y: e.clientY,
				t: e.timeStamp
			};
			const move = (ev) => {
				const dt = Math.max(1, ev.timeStamp - lastPt.t);
				sounds.scrape(Math.hypot(ev.clientX - lastPt.x, ev.clientY - lastPt.y) / dt * 1e3);
				lastPt = {
					x: ev.clientX,
					y: ev.clientY,
					t: ev.timeStamp
				};
				const r = clampToPressing(radiusAt(ev.clientX, ev.clientY), bands, geo);
				last = radiusToPosition(bands, r);
				wroteDeg = styleVar(arm, "--deg", `${armAngleDeg(r, geo, mountPoint).toFixed(2)}deg`, wroteDeg);
				showCue(r);
				if (!zoomed) {
					zoomed = true;
					deck.classList.add("zoomed");
					paintAt(CUE_ZOOM);
				}
			};
			const up = () => {
				dragging = false;
				sounds.endScrape();
				deck.classList.remove("dragging");
				deck.classList.remove("zoomed");
				paintAt(1);
				target.removeEventListener("pointermove", move);
				target.removeEventListener("pointerup", up);
				target.removeEventListener("pointercancel", up);
				if (!last) return;
				const queueIndex = (side?.start ?? 0) + last.index;
				if (queueIndex === currentIndex) {
					host.actions.seek(cueTarget(last));
					return;
				}
				const running = !motorOff && !armUp;
				const load = host.actions.loadQueueIndex;
				if (typeof load === "function" && (!running || typeof host.actions.setPlaying === "function")) {
					load.call(host.actions, queueIndex, cueTarget(last));
					resumingCue = running;
					pendingPlay = running;
					return;
				}
				host.actions.playQueueIndex(queueIndex);
				restoringCue = !running;
			};
			try {
				target.setPointerCapture(e.pointerId);
			} catch {}
			target.addEventListener("pointermove", move);
			target.addEventListener("pointerup", up);
			target.addEventListener("pointercancel", up);
		}
		/**
		* Tell the host what the deck's mechanisms currently add up to.
		*
		* The one place `setPlaying` is called from, so the invariant above can't be
		* violated by a control forgetting a term: a control changes its own mechanism
		* and then asks here, rather than deciding for itself whether music should be
		* playing. That is also why START and the lever can disagree without either
		* being wrong — pressing START with the arm up starts the platter and nothing
		* else, exactly as it would on the desk.
		*
		* States the value rather than toggling, per the contract — a visualizer renders
		* from a snapshot that may be a frame stale, and a toggle read against a stale
		* snapshot inverts. The `typeof` guard keeps an older host without the action
		* degrading to the decorative controls it had before, instead of throwing on
		* every click.
		*/
		function syncTransport() {
			if (typeof host.actions.setPlaying !== "function") return;
			const want = !motorOff && !armUp;
			pendingPlay = want;
			host.actions.setPlaying(want);
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
			if (pitch) wroteTravel = styleVar(pitch, "--travel", String(percentToTravel(percent)), wroteTravel);
			if (pval) {
				const text = formatPercent(percent);
				if (text !== wrotePval) pval.textContent = text;
				wrotePval = text;
			}
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
				sounds = createLazyDeckSounds(() => h.audio ?? null);
				unregisterSounds = registerDeckSounds(sounds);
				doc = root.ownerDocument;
				const style = doc.createElement("style");
				style.textContent = DECK_CSS;
				root.append(style);
				deck = doc.createElement("div");
				deck.className = `deck lifted skin-${cfg.name}` + (h.reducedMotion ? " reduce-motion" : "");
				deck.style.setProperty("--cue-zoom", String(CUE_ZOOM));
				deck.innerHTML = "<div class=\"stage\">" + (cfg.furniture ? PLINTH_HTML : "") + "<div class=\"platter\">" + (cfg.furniture ? "<div class=\"rim\"><i class=\"dots\"></i></div>" : "") + "<div class=\"body\"></div><div class=\"spin\"><div class=\"slipmat\"><span>Viboplr</span><span>Viboplr</span></div><canvas></canvas><div class=\"shimmer\"></div><div class=\"label\"></div></div><div class=\"sheen\"></div><div class=\"iris\"></div><div class=\"hole\"></div><div class=\"cue-ring\"></div><div class=\"lever\"><i></i></div><div class=\"armwrap\"><div class=\"armrise\"><div class=\"arm\"><div class=\"armlift\"><div class=\"counter\"></div><div class=\"pivot\"></div><div class=\"tube\"></div>" + (cfg.furniture ? SARM_SVG : "") + "<div class=\"shadow\"></div><div class=\"head\"><i class=\"collar\"></i></div></div></div></div></div></div></div><div class=\"cue-readout\"></div>";
				root.append(deck);
				stage = deck.querySelector(".stage");
				cueRing = deck.querySelector(".cue-ring");
				cueReadout = deck.querySelector(".cue-readout");
				platter = deck.querySelector(".platter");
				spin = deck.querySelector(".spin");
				canvas = deck.querySelector("canvas");
				label = deck.querySelector(".label");
				arm = deck.querySelector(".arm");
				lever = deck.querySelector(".lever");
				rest = deck.querySelector(".rest");
				deck.querySelector(".head").addEventListener("pointerdown", onDown);
				lever.addEventListener("click", () => {
					armUp = !armUp;
					parked = false;
					syncTransport();
				});
				deck.querySelector(".start")?.addEventListener("click", () => {
					motorOff = !motorOff;
					syncTransport();
				});
				dots = deck.querySelector(".dots");
				s33 = deck.querySelector(".s33");
				s45 = deck.querySelector(".s45");
				s33?.addEventListener("click", () => {
					sounds.click("speed");
					setRate(composeRate(1, decomposeRate(rate).percent));
				});
				s45?.addEventListener("click", () => {
					sounds.click("speed");
					setRate(composeRate(RATE_45, decomposeRate(rate).percent));
				});
				pitch = deck.querySelector(".pitch");
				pval = deck.querySelector(".pval");
				pitch?.addEventListener("pointerdown", onPitchDown);
				deck.querySelector(".reset")?.addEventListener("click", () => {
					sounds.click("detent");
					setRate(decomposeRate(rate).basis);
				});
				unsubs.push(h.onResize((s) => {
					size = s;
					lastRevision = -1;
				}));
				unsubs.push(h.onSkinChange(() => {}));
			},
			frame(state) {
				if (restoringCue) {
					if (state.playing && !wasPlaying) syncTransport();
					else if (!state.playing) restoringCue = false;
				}
				if (resumingCue && !state.stopped && !state.playing) {
					resumingCue = false;
					syncTransport();
				}
				if (state.stopped && !wasStopped) {
					motorOff = true;
					armUp = true;
					parked = true;
					pendingPlay = false;
					restoringCue = false;
					resumingCue = false;
				} else if (state.playing && !wasPlaying && !restoringCue) {
					motorOff = false;
					armUp = false;
					parked = false;
					pendingPlay = false;
				} else if (!state.playing && !motorOff && !parked && !pendingPlay) armUp = true;
				wasPlaying = state.playing;
				wasStopped = state.stopped;
				wroteLifted = cssClass(deck, "lifted", armUp || parked, wroteLifted);
				wroteMotorOff = cssClass(deck, "motor-off", motorOff, wroteMotorOff);
				rate = typeof state.rate === "number" && state.rate > 0 ? state.rate : 1;
				if (state.queueRevision !== lastRevision) sides = splitSides(state.queue.map((t) => t.durationSecs));
				side = sideAt(sides, state.currentIndex);
				const sideStart = side?.start ?? -1;
				if (state.queueRevision !== lastRevision || sideStart !== lastSideStart) {
					lastRevision = state.queueRevision;
					lastSideStart = sideStart;
					repress(state.queue);
				}
				const empty = bands.length === 0;
				wroteEmpty = cssClass(deck, "empty", empty, wroteEmpty);
				currentIndex = state.currentIndex;
				const art = empty ? null : state.queue[state.currentIndex]?.artUrl ?? null;
				if (art !== lastArt) {
					lastArt = art;
					label.style.backgroundImage = art ? `url("${art}")` : "";
				}
				if (!dragging) {
					if (empty || parked) {
						if (restDeg !== null) wroteDeg = styleVar(arm, "--deg", `${restDeg.toFixed(2)}deg`, wroteDeg);
					} else {
						const rel = state.currentIndex - (side?.start ?? 0);
						const idx = Math.max(0, Math.min(bands.length - 1, rel));
						const r = positionToRadius(bands, idx, state.positionSecs, geo);
						wroteDeg = styleVar(arm, "--deg", `${armAngleDeg(r, geo, mountPoint).toFixed(2)}deg`, wroteDeg);
					}
				}
				const pitchState = decomposeRate(rate);
				if (s33) wroteS33 = cssClass(s33, "on", pitchState.basis === 1, wroteS33);
				if (s45) wroteS45 = cssClass(s45, "on", pitchState.basis !== 1, wroteS45);
				if (!scrubbingPitch) showPitch(pitchState.percent);
				wroteOffSpeed = cssClass(deck, "off-speed", Math.abs(pitchState.percent) > .05, wroteOffSpeed);
				if (!host.reducedMotion) {
					const dt = lastMs === null ? 0 : Math.max(0, Math.min(250, state.timeMs - lastMs));
					const target = motorOff ? 0 : rate;
					const tau = target === 0 ? BRAKE_TAU_MS : SPINUP_TAU_MS;
					spinVel += (target - spinVel) * (1 - Math.exp(-dt / tau));
					if (Math.abs(target - spinVel) < .001) spinVel = target;
					spinAngle = (spinAngle + dt / 1800 * 360 * spinVel) % 360;
					wroteSpin = styleTransform(spin, `rotate(${spinAngle}deg)`, wroteSpin);
					const armedNow = armUp || parked;
					if (sndArmUp !== null && armedNow !== sndArmUp) armedNow ? sounds.lift() : sounds.drop();
					sndArmUp = armedNow;
					if (sndMotorOff !== null && motorOff !== sndMotorOff) sounds.click("transport");
					sndMotorOff = motorOff;
					if (sndIndex !== null && state.currentIndex !== sndIndex) sounds.click("band");
					sndIndex = state.currentIndex;
					sounds.frame(spinVel, !armedNow && !empty);
					if (dots) {
						const reference = spinVel > .05 ? 1 : 0;
						dotAngle = (dotAngle + dt / 1800 * 360 * (spinVel - reference)) % 360;
						wroteDots = styleTransform(dots, `rotate(${dotAngle}deg)`, wroteDots);
					}
				}
				lastMs = state.timeMs;
			},
			destroy() {
				for (const u of unsubs) try {
					u();
				} catch {}
				unsubs.length = 0;
				unregisterSounds?.();
				unregisterSounds = null;
				sounds.destroy();
				sounds = createDeckSounds(null);
				sndArmUp = sndMotorOff = null;
				sndIndex = null;
			}
		};
	}
	//#endregion
	//#region src/index.ts
	function activate(api) {
		api.visualizers.onMount("deck", () => createVinylDeckVisualizer("studio"));
		api.visualizers.onMount("sl1200", () => createVinylDeckVisualizer("sl1200"));
		installSoundPanel(api);
	}
	function deactivate() {}
	//#endregion
	exports.activate = activate;
	exports.deactivate = deactivate;
	return exports;
})({});
return __viboplrPlugin;
