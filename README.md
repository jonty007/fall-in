# FALL IN

A 108-second film that flies toward, around and back out from a non-spinning black hole. Every frame is ray-traced
in a WebGL2 fragment shader by integrating real light paths (Schwarzschild null geodesics, RK4); the accretion disk's
colour comes from a Novikov–Thorne temperature profile through the Planck spectrum, with Doppler beaming and
gravitational redshift; the starfield is lensed by the same rays. The score is synthesised in code.

* `STORYBOARD.md` — beats, hero shots, palette, type, music plan
* `SOURCES.md` — every on-screen fact and where it was checked
* `DECISIONS.md` — every decision made along the way, including the review-round findings
* `film/out/` — deliverables (stills, contact sheet, poster, preview, score) and, after you render, `film_16x9.mp4`

## Render the film on your computer (GPU)

Requirements: Node.js 18+ (tested on 22), a GPU with working WebGL2 in Chrome, ~6 GB free disk while rendering.

```bash
npm install            # Playwright, fonts, ffmpeg/ffprobe binaries
npm run setup          # downloads Playwright's Chromium (once)
npm run render         # → film/out/film_16x9.mp4
```

`npm run render` opens the film page in Playwright Chromium on your GPU, seeks to each frame (`window.seek(t)`),
waits for the full draw and screenshots it at 1920×1080 × deviceScaleFactor 2 (3840×2160). Frames are rendered in
5-second chunks; each chunk is Lanczos-downscaled to 1080p, converted to BT.709 and stored as a near-lossless 10-bit
intermediate, then its PNGs are deleted. **It is resumable**: stop it any time and run it again; finished chunks are
kept in `film/out/chunks/final/`. When all chunks exist they are joined, muxed with the score and encoded to the
delivery spec:

* 1920×1080, 30 fps, 108 s, H.264 High, yuv420p, CRF 17, preset slow, tagged BT.709 (primaries, transfer, matrix, TV range)
* AAC 256 kb/s, 48 kHz stereo, `+faststart`, under 95 MB

The script prints the WebGL renderer it got. If it says *SwiftShader*, Chromium did not get your GPU; try
`npm run render -- --headed` (a visible window), and on Linux make sure Vulkan drivers are installed.

Useful options (after `--`):

| option | effect |
|--------|--------|
| `--headed` | run Chromium with a window (most reliable GPU access on some systems) |
| `--cpu` | force SwiftShader software rendering (works anywhere, ~40 s per frame) |
| `--preview` | 640×360 preview → `film/out/preview_640x360.mp4` |
| `--from=40 --to=60` | render only the chunks covering that time range |
| `--keep-frames` | keep the PNG frames of finished chunks |

Rough timing: on a recent desktop GPU most of the time is spent capturing 4K PNGs (≈ 1–2 s per frame, so about
1–2 hours). In this repository's build container, which has no GPU, one full-quality frame took ≈ 37 s in SwiftShader.

### Other scripts

```bash
npm run audio      # re-synthesise the score → film/out/score.wav (+ score_report.json, score_spectrogram.png)
npm run stills     # one full-resolution still per beat → film/out/stills/
npm run contact    # contact sheet, one frame every 2 s → film/out/contact_sheet.jpg
npm run strip -- --start=69   # 1 s of full-resolution frames for flicker checks
npm run serve      # then open http://127.0.0.1:5173/film/src/index.html?t=42 to look at any moment
node film/scripts/poster.mjs          # portrait poster → film/out/poster.jpg
node film/scripts/measure.mjs --times=24.5,55.5   # exposure check: clipped-white %, body median, p99
node film/scripts/verify.mjs film/out/film_16x9.mp4   # checks the file against the delivery spec, grabs frames
node film/scripts/layout.mjs        # text layer only: reports any label touching a path or leaving the safe area
```

Every frame is a pure function of time: the page exposes `window.seek(t)` (returns when the frame is fully drawn)
and `window.duration`. There are no clocks and no state carried between frames; all randomness is seeded integer
hashing, so the same `t` gives the same image on any machine.

## How it works

* **Light paths** (`film/src/shaders/scene.js`). Each pixel's ray lies in a plane through the hole, where the photon
  orbit obeys `u'' = 3Mu² − u` (u = 1/r). It is integrated with RK4 in φ with adaptive steps (fine near the photon
  sphere); disk crossings and the escape direction are found exactly on the cubic Hermite interpolant of the RK4
  state, so there are no stepping bands. Rays near the critical impact parameter (the photon ring) get 8× adaptive
  supersampling. The camera is a static observer, so the shadow has its true size even at 1.7 rₛ.
* **Disk**. Page–Thorne flux (verified against the closed form), T_peak 4500 K, Keplerian rotation, turbulence
  (clumps, sparse dark filaments, hot knots) sheared by differential rotation for a bounded time, redshift `g = 1/[√(1−2M/r_cam)·uᵗ·(1 − Ω b_z)]`; the observed colour is the
  Planck spectrum at gT through the CIE 1931 colour-matching functions.
* **Stars**. Four procedural layers with realistic number counts and blackbody colours, drawn through the local
  Jacobian of the lens map so they stay anti-aliased and stretch into arcs near the Einstein ring, with motion
  blur from the camera's rotation about the hole mapped through the same Jacobian (180° shutter).
* **Image**. HDR (RGBA16F) → bloom on the hottest regions only → highlight compression of the disk light (log
  space, chromaticity kept; the disk spans ≈ 12 stops) → ACES filmic → warm-only saturation → vignette → grain +
  dither.
  Text and diagrams are drawn on their own 2D canvas (never blurred or graded) and blended in the very last WebGL
  pass, so every captured frame pairs the picture with the text of the same instant.
* **Ray differentials**. Alongside each ray the shader integrates the Jacobi field `j'' = (6u − 1) j`, which gives
  every disk hit its exact pixel footprint (texture filtering for primary, lensed and photon-ring images) and the
  exact lens Jacobian for the stars — no screen-space derivatives.
* **Score** (`film/audio/`). Plain-JS synthesis at 48 kHz: detuned-saw pads through a moving state-variable filter, an
  FM glass motif, a heartbeat pulse that is the film's clock, sound effects driven by the same timeline as the
  pictures (the circling ray pans around you, the plunging particle chirps), a generated convolution reverb,
  mid/side widening, glue compression and a look-ahead true-peak limiter to −14 LUFS / −1.5 dBTP.

## Layout

```
film/src/        page, renderer, shaders, timeline, overlays, physics
film/audio/      DSP toolkit, loudness meter/limiter, the score
film/scripts/    render, stills, contact sheet, strip, audio, static server
film/out/        deliverables
film/review/     review-round material (stills, contact sheets, flicker strips)
```
