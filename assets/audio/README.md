# Background audio

Put a royalty-free audio file in this folder (e.g. `background.mp3`) to mux into
the daily video via `scripts/build-video.js`.

Drop any royalty-free `.mp3` / `.wav` / `.m4a` / `.aac` here — the build
rotates through those custom tracks by post date (one different song per day).
`ambient-bed.mp3` is only used as a last-resort fallback when no other audio
file is present.

In GitHub Actions, missing audio **fails the build** (unless `ALLOW_SILENT_VIDEO=true`)
so silent Reels don’t ship by accident.

Good free music sources if you want to replace the default:
- YouTube Audio Library (studio.youtube.com -> Audio Library) — “no attribution required”
- Pixabay Music (pixabay.com/music)
- Instagram/Meta Sound Collection (business.facebook.com/sound-collection)

Keep the track at least as long as the video (currently ~15s) and prefer a calm,
minimal instrumental that fits the black/white/gray premium finance aesthetic.
