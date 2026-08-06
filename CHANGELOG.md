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
