# Decisions

A running log of every decision made while building FALL IN without asking questions. Newest sections at the
bottom of each heading.

## Physics and rendering

1. **Integrator: Binet photon equation, RK4 in φ, per pixel.** A Schwarzschild null geodesic stays in a plane through
   the hole, and in that plane `u'' = 3Mu² − u` (u = 1/r, ' = d/dφ) is exact. Integrating 2 variables instead of
   6 makes each pixel ~5× cheaper than a 3D integrator for identical physics, so we can afford small steps
   (Δφ = 0.017 near the photon sphere, up to 0.16 far away) and up to 1100 steps for rays that wind around the
   photon sphere. This is still "integrating null geodesics with RK4" — no lensing textures or look-up of
   deflection angles.
2. **Exact disk crossings and exact escape directions.** The orbital plane meets the disk plane at known angles
   φₖ, so each crossing is located by cubic Hermite interpolation of the RK4 state (no stepping bands). A ray
   escapes where u → 0; that zero is found on the same Hermite cubic, which gives the exact asymptotic sky
   direction (no "far sphere" error).
3. **Camera = static observer.** Each frame's camera hovers at rest relative to the hole (local static frame), so
   the radial component of the ray direction is scaled by √(1 − 2M/r) to convert the locally measured angle to
   the coordinate angle. This gives the correct shadow size even very close in (at 1.7 rₛ the shadow covers ≈ 40 %
   of the sky). Camera motion is treated as a sequence of static observers (no aberration from camera speed); a
   documentary-style choice that keeps every frame a pure, physical snapshot.
4. **Doppler/redshift.** `g = 1/[√(1−2M/r_cam)·uᵗ·(1 − Ω b_z)]` for gas on Keplerian circular orbits; the observed
   spectrum of a blackbody of temperature T is a blackbody at gT, so colour *and* brightness both come from the
   Planck spectrum at gT (equivalent to I_ν/ν³ invariance). Starlight is blueshifted by 1/√(1−2M/r_cam) for the
   static camera.
5. **Disk temperature.** Page–Thorne profile computed by numerically integrating the general formula (checked
   against the a = 0 closed form, agreement 1e‑5). Peak at r ≈ 9.6 M (4.8 rₛ). Real AGN disks peak in the UV
   (10⁵ K); we scale the profile to a **visible-light disk with T_peak = 4000 K** so the palette is
   blackbody orange-to-white: the body reads orange (≈ 2500–3500 K observed) and only Doppler-boosted gas
   reaches white. This scale is the one artistic liberty in the physics and is stated here.
6. **Disk turbulence.** Simplex-noise fBm in the co-rotating frame, sheared by Keplerian Ω(r) for a 420 M
   lifetime and cross-faded between two layers (so the pattern spirals naturally and never winds up into
   noise). Octaves are faded by an analytic pixel-footprint estimate so the disk does not shimmer.
7. **Stars.** Three cube-map cell layers (bright/medium/faint), magnitudes drawn from number counts
   N(<m) ∝ 10^{0.6m}, colours from blackbody temperatures (mostly K/G/F, some A/B, desaturated toward white).
   Each star is drawn as a pixel-space Gaussian through the local Jacobian of the lens map (screen-space
   derivatives of the escaped direction), which anti-aliases lensed stars, conserves flux, stretches them into
   arcs near the Einstein ring and fades to the layer's mean radiance where the cells are under-resolved (no
   sparkle near the shadow).
8. **Galaxy band** placed so it crosses behind the hole at ~30° in most shots; its lensed copies wrap around the
   shadow.
9. **No-beaming comparison = Interstellar's choice.** James et al. 2015 (fig. 15a) show the movie disk with no
   frequency shifts at all, so the "without" side of the Doppler wipe uses g = 1 (no Doppler, no gravitational
   shift).

## Pipeline and performance

10. **Raw WebGL2, no three.js.** One expensive scene pass into an RGBA16F target, then bloom (thresholded so
    only the hottest disk regions bloom), optional telescope blur, and a composite with tone mapping, grade,
    vignette, grain and dither. The scene pass is drawn in 128-row scissor tiles with `gl.finish()` between
    them so no single GPU task can trip a watchdog under SwiftShader.
11. **Performance here.** One full-quality frame (3840×2160 internal, i.e. 1920×1080 at deviceScaleFactor 2)
    takes **≈ 37 s** in SwiftShader on this 4-core container — far over the 8 s limit. Per the brief, the final
    full-quality film is left for `npm run render` on a GPU; here we deliver code, full-resolution stills, contact
    sheets, poster, audio and a 640×360 preview. Quality settings are identical everywhere; only the pixel count
    differs between preview and final.
12. **Integer hashing (PCG) for all randomness** so the image is identical across GPUs/drivers (float `sin`
    hashes are not).

## Look development

13. **Tone mapping: ACES filmic (Stephen Hill's RRT+ODT fit).** Compared side by side with AgX (base and
    punchy looks). AgX rendered the blackbody oranges as muddy tan/brown; ACES keeps a saturated ember orange in
    the body of the disk and rolls the Doppler-boosted gas to warm white, which is the brief's palette.
14. **Disk temperature scale: T_peak = 3600 K** (after trying 7800, 5200, 4500, 4000 K). Lower values make the
    disk body read as glowing orange instead of beige; the approaching side still reaches white.
15. **Inner-edge glow.** The classic zero-torque Page–Thorne disk goes dark at the ISCO (T → 0), so the
    innermost-stable-orbit beat would have no visible edge. We add the constant term of a small stress at the
    inner edge (magnetic stresses at the ISCO, Agol & Krolik 2000, ApJ 528, 161): T(r_ISCO) = 0.71 T_peak, the
    peak stays at r ≈ 9.4 M. The disk still ends exactly at 3 rₛ.
16. **Optically thick disk.** τ ≈ 4 in the body (thin disks are optically thick), wispy and translucent only toward
    the outer edge. A translucent body let the lensed underside show through the near side as a ghostly bowl.
17. **Ridged noise removed** from the disk: its cusps aliased into scratch-like lines at grazing angles.
18. **Texture filtering from real footprints.** Disk hits are recorded during integration and shaded after the
    loop, where screen-space derivatives of each hit position give the exact footprint for primary, lensed and
    photon-ring images. Noise octaves fade smoothly over two octaves to avoid visible per-quad steps.
19. **Adaptive 4× supersampling of the photon ring.** Rays with impact parameter within 10 % of √27 M form the
    exponentially thin higher-order images, which point-sampled into a dotted line. Those pixels (a thin annulus)
    trace four extra rotated-grid rays. The disk's inner edge is also filtered by coverage.
20. **Look-dev stills** saved in `film/out/lookdev/` (far view, edge-on hero, high view).

## Film structure, camera and text

21. **One continuous flight, no cuts.** Camera keyframes per channel (log r, inclination, azimuth, yaw, pitch, roll,
    FOV, exposure) interpolated with monotone cubic (Fritsch–Carlson) splines: C¹, never overshoots, and eases
    naturally where a fast move meets a slow drift. No channel ever stops dead inside a shot.
22. **Gravity beat placed just outside the disk's rim (r ≈ 45 M, 5° above the plane)** so the far side of the disk
    is visible both over and under the shadow. From inside the rim the near disk hides the lower image — the
    side-panel ray tracer showed no "under" rays at 8° from 26 M, so the shot was moved rather than the caption
    fudged.
23. **Close orbit framed as a "shadow horizon".** At 1.7 rₛ the camera pitches up 68° from the hole so the shadow
    edge runs across the frame: shadow below, the disk band and the lensed galaxy arcing above. Looking at the hole
    itself would fill the frame with black (the shadow's half-angle is 78.7° there). The disk light is
    blueshifted ×1.5 for the static camera, so exposure drops to 3.6; the background star gain is raised ×5 on the
    dive so the lensed star rings stay readable (stated here because it is a lighting choice, not physics).
24. **Payoff at 17° from the axis**, rolled 90° so the Doppler-bright side is at the bottom like the 2017 M87*
    image. The telescope view blurs a disk-only render target (a second MRT output) with a Gaussian of
    FWHM = 20/42 of the ring diameter — the EHT's ≈ 20 µas resolution relative to its 42 µas ring. Stars are not in
    the telescope view because a 1.3 mm interferometer would not see them.
25. **Text legibility over a bright disk**: soft graded scrims (a smooth darkening of the image under text blocks,
    no edges, no blur) plus a dark halo behind glyphs. Glyphs are drawn twice (halo pass, then clean pass) so they
    stay crisp.
26. **Typography**: Cormorant Garamond for headlines (italic for the opening question), Jost for title/captions,
    IBM Plex Mono for readouts and diagram labels. Headlines 64–70 px, captions 38 px, title 132 px.
27. **Side panels are computed, not drawn**: the same photon-orbit equation (RK4 in the orbital plane) traces the
    light paths; the ISCO panel integrates timelike geodesics (`u'' = 1/L² − u + 3u²`) for a stable precessing orbit
    starting at 3.4 rₛ and a plunge starting at 2.9 rₛ.
28. **Readouts are live formulas**: photon-sphere radius from the maximum of the photon potential (1.500 rₛ),
    ISCO from dL/dr = 0 (3.000 rₛ, v = 0.500 c), g = 1.41/0.47 and the g⁴ ratio (81×) from the redshift formula,
    clock rate √(1 − rₛ/r) and starlight blueshift from the camera radius.

## Score

29. **Synthesised in plain Node.js** (no samples, no Web Audio dependency) so `npm run audio` is deterministic and
    runs anywhere. 48 kHz float, written as 32-bit float WAV, encoded to AAC 256k at mux time.
30. **Harmony**: D minor (Dm9 – B♭maj7 – Gm9 – Asus4/A), a darker Neapolitan colour (E♭/D) for the ISCO, an F-major
    lift for the Doppler beat, a D–E♭ cluster on the dive, B♭maj9 swell after the silence, final D major (Picardy
    third). Original motif D–A–B♭–F–E on an FM glass voice at the title, the photon sphere (octave up) and the payoff
    (in octaves).
31. **Heartbeat = the film's clock**: 60 bpm so beats land on whole seconds (every beat boundary in the timeline is a
    whole second), slowing geometrically on the dive, last beat at 83.3 s, true digital silence 86.0–87.0 s
    (20 ms fades), swell at 87.0 s.
32. **Sound effects follow the pictures**: ticks when each traced ray reaches "you" in the gravity panel; a glassy
    tone whose stereo position follows the circling ray in the photon panel; a chirp whose pitch follows the
    plunging particle's orbital frequency (and pans with it) ending in a thump at the horizon; filtered-noise
    pass-bys that follow the Doppler wipe across the screen; a rumble building to the closest point.
33. **Mastering**: 26 Hz high-pass ×2, −1.5 dB at 280 Hz, +1 dB air shelf, mid/side widening above 160 Hz (lows
    mono), 1.6:1 glue compression, then gain + look-ahead true-peak limiter iterated to −14.0 LUFS integrated with a
    −1.5 dBTP ceiling (margin for AAC). Verified independently with ffmpeg's `ebur128`. A dynamic arc is written into
    the mix (≈ −25 LUFS short-term in the intro, ≈ −16 in the build, −10 at the swell) instead of flat loudness.
34. **Spectrogram on a linear frequency axis**: ffmpeg 7's `showspectrumpic` log-frequency labels are wrong (a
    36.7 Hz test sine is drawn at "≈ 800 Hz"), which first looked like a spurious tone; per-bus Goertzel checks
    confirmed the audio is clean.

## Delivery encode

35. **Intermediate**: x264 4:4:4 10-bit CRF 4 per 5 s chunk, after Lanczos 2×→1× downscale and an explicit BT.709
    matrix (swscale defaults to BT.601). sRGB-encoded frames are treated as display-referred R'G'B' (no transfer
    conversion), the common practice for screen-referred content tagged BT.709.
36. **Final**: CRF 17 / preset slow / High / yuv420p as specified, plus a VBV cap (6.5 Mb/s max, 13 Mb buffer) that
    only engages if a passage would push the file past 95 MB.

## Review rounds

Each round: a full-resolution still per beat, a contact sheet (one frame every 2 s), and a 1 s full-resolution
strip of the busiest moment, reviewed by a fresh subagent that has not seen the code, acting as a harsh
motion-design art director (with 100 % crops). Material is kept in `film/review/roundN/`.

### Round 1 — five worst findings and what was done

1. **Diagram panels were dark UI cards with HUD corner brackets, and three beats in a row used the same
   slide-like layout.** → Cards, brackets and tracked-caps titles removed. Diagrams are drawn on an offscreen
   layer and composited through a soft elliptical mask (lines fade out, never clipped), with an image-level
   graded darkening behind them. Labels get a soft black knockout so lines never cut through text. Layout now
   differs per beat: side diagram (gravity), full-frame diagram interlude over the dimmed shot (photon
   sphere), small corner inset (ISCO), no diagram (Doppler, close orbit).
2. **Disk read as sepia wood grain: one hue, no white-hot range, no bloom, barcode stripes.** → T_peak raised
   to 4300 K with exposures cut ×0.4, so Doppler-boosted gas really goes white-hot and blooms while the body
   stays ember orange and the cool outer disk falls to deep red-black (the dim receding side now glows instead
   of reading as a black slab). Mid-tone saturation grade after ACES. Turbulence: three cross-faded layers
   with variance-preserving normalisation, shorter shear lifetime, stronger clumps, weaker fine streaks,
   gentler spiral pitch.
3. **Aliasing: quad-stepped texture filtering in lensed arcs, jagged photon ring, hard 1-px stars.** →
   Exact per-pixel ray differentials: the Jacobi field j = ∂u/∂α (j'' = (6u − 1) j) is integrated with RK4
   alongside every ray, giving smooth disk footprints for every image order and the exact sky Jacobian for
   the stars (no 2×2-quad derivatives anywhere). Photon-ring supersampling raised to 8 extra rays. Star PSF
   widened (σ 1.25 render px), star colours less desaturated with more blue-white stars, star brightness
   normalised per 1080p pixel of the current lens (same look at any zoom), a fourth fine star layer for
   narrow lenses. (The short "dashes" near the hook's Einstein ring are genuinely lensed star arcs; kept.)
4. **Text legibility and colour system: text over bright disk, ice-blue readouts (a fifth colour), fallback
   glyphs for ₛ/≈/√/arrows, old-style figures, debug-sounding "(numerical)".** → All text warm white, hierarchy
   by face/size/opacity. None of the three typefaces carries ≈, √, →, ₛ or ⁴ (checked glyph by glyph in the
   browser), so the overlay renders subscripts/superscripts itself and draws "≈" as a vector glyph; arrows,
   √ and ∝ were rephrased out. Headlines avoid digits. Readouts reworded ("solved from the geodesic
   equation"), one precision per value. Citation moved under the caption at 30 px, held 4.4 s. Stronger
   scrims under readouts.
5. **Payoff promised "the first real image" but never showed it; end card over a brown stain.** → The real EHT
   image is not copied (brief: text only), so the beat is retitled "What a telescope would see": our hole
   blurred to EHT resolution, then "M87*, 2019: also a lopsided ring." with the facts in two short mono lines.
   Wipe labels clamped inside the frame; stars removed from the telescope view's bloom. The blur is undone
   before the end card, so the title sits over a held, sharp, dimmed ring; title tracking tightened to 0.32 em.

Also fixed from the round-1 list: Doppler beat restructured so the headline never contradicts the picture
("One side is brighter" only while beaming is on; "How Interstellar showed it" over the no-shift frame); the
close-orbit headline no longer claims 1.7 rₛ before the camera is there ("Just outside the photon sphere",
from 81.4 s) and its text sits in the black of the shadow; title moved clear of the lower lensed arc; grain now
reaches the blacks (black lifted 1.5/255, luminance-weighted grain floor); the pull-back after the silence
gets two intermediate keys so the hole is never stranded in a corner; galaxy haze reduced, its stars denser.

## Capture

37. **Text layer composited inside the WebGL canvas.** A half-second motion sheet of the dive showed the
    previous frame's caption on alternating frames: with two DOM canvases, headless Chromium can screenshot a
    stale 2D-canvas commit while the GPU process is busy with a long SwiftShader draw. The overlay is still
    drawn on its own 2D canvas (never blurred, never graded), but it is now uploaded as a premultiplied texture
    and blended in the last WebGL pass, after grade and grain, so every screenshot pairs the image with the
    overlay of the same `t`. The DOM overlay canvas is hidden.
38. **Poster**: portrait 2000×3000 (`film/out/poster.jpg`, `film/scripts/poster.mjs`), rendered by the same
    shader at 1200×1800 CSS px × 2 and Lanczos-scaled, with the opening question, title and credit.

### Round 2 — five worst findings and what was done

1. **Diagrams still pasted onto the hero render** (the photon interlude showed a filled schematic hole next to
   the real shadow; labels on smoked "chips"; rays crossing readouts; V-corners where rays met the disk line;
   a scribbly three-loop orbit). → Diagrams are strokes only (no filled shapes); the shot under the photon
   interlude is pulled down ~4.6 stops so the diagram reads as a plate; the diagram starts only after the dim;
   labels sit outside the strokes on 1 px leader lines (no chips); the gravity diagram's disk is a heavier
   soft bar with an emission dot where each ray leaves it; the stable orbit is two clean loops; glowing path
   heads replaced by small crisp dots; masks tightened so nothing runs into text.
2. **Disk still read as brushed metal/wood; no hot core in face-on and no-Doppler views; flat white clip; grade
   drift.** → Exposure set by measurement instead of by eye (`film/scripts/measure.mjs` renders each camera key
   without text and reports clipped-white %, body median and p99): ≈ 1–3 % clipped white where the Doppler side
   is hot, body median ≈ 0.3–0.4, p99 ≈ 0.94; face-on ISCO +1.5×, photon shot −0.5×, close orbit −0.75×,
   payoff +1.3×, and an exposure ease tied to the Doppler wipe because the no-shift disk is uniformly bright.
   T_peak 4500 K (4800 K pushed the body to cream). Turbulence made more isotropic (clumps, sparse hot knots,
   fewer concentric stripes, shorter shear lifetime) and filtered more conservatively.
3. **Payoff caption made our blurred render read as the EHT photo.** → A leader-line label pins "our render,
   at EHT resolution" to the ring for the whole payoff; the caption says "The real M87*: also a lopsided ring."
   and the facts start with "for comparison, M87* (EHT, 2019):". The ring was made ~13 % smaller so its halo
   clears the type.
4. **Type too small or on bright disk; some captions too short; three stacked centred tiers.** → Every label
   and readout is now ≥ 34 px; readouts cut to two short lines ("time runs 2.3% slower" instead of
   "clock 0.977 × …"); stronger, larger scrims; the first Doppler caption held 4.7 s; the citation tier merged
   into the caption ("Left out on purpose, per Thorne’s team, 2015."), full reference in SOURCES.md. The end-card
   credit keeps the brief's exact 10-word wording (it is the requested credit, not a caption).
5. **Motion: strobing 1 px wipe line, wipe labels pinned on the wrong side, popping lensed stars, dotted
   higher-order photon ring, shimmer on the far-side arc.** → The wipe line is smeared over its half-frame
   travel (180° shutter) and runs full height with a softer seam; its labels travel with it and fade near the
   frame edges. Star magnification capped at 24× (finite star size) so stars near caustics no longer flash.
   Disk images thinner than ~3 px are routed into a third render target and softened with a σ ≈ 1.1 px
   (output) Gaussian before compositing, so the n ≥ 2 rings draw as continuous hairlines instead of dots.
   Disk texture filter widened (footprint × 3).

Also from round 2: title cards re-set in Cormorant Garamond 500 with moderate tracking instead of thin, widely
spaced geometric capitals; end card re-framed so the dim ring sits above the title and the credit runs over
black; close-orbit star gain lowered (×3 instead of ×5) and its galaxy haze reduced; a soft scrim under the title
subdues lensed star arcs near the letters; repeated "solved from the geodesic equation" lines removed.

### Round 3 — five worst findings and what was done

1. **Text on the brightest part of the disk** (ISCO readout ≈ 3.5:1 on cream streaks; Doppler readout on the hot
   near side over a scrim with a visible vertical edge; gravity headline on the upper arc). → The shots were
   recomposed around the text instead of darkening under it: in the gravity and ISCO beats the hole moves to
   the left (gravity FOV 27° → 34°, yaw −12°; ISCO yaw −13°) and every word and diagram sits in a right-hand
   column over sky or over the dim, receding side, under one wide soft scrim (no rectangles). The Doppler
   readout became two short blocks in the sky on either side of the hole, on the side each describes
   ("approaching / light 1.41× bluer", "receding / light 2.1× redder"). All text is full warm white.
2. **Diagrams crossing their own labels; a "ball of string" ISCO inset.** → Every frame now runs a layout check
   (`film/scripts/layout.mjs`, text layer only, every 0.25 s): any label box touched by a drawn path, two text
   blocks overlapping, or text outside a 30 px safe area is reported; the film is clean. Leaders stop 8 px from
   the text box at its nearest edge (they used to end inside centred labels). Gravity diagram moved above the
   real disk's plane so the two disks never line up; under-rays chosen so the "far side" leader is clear. Photon
   interlude: the shot fades out completely (no second hole, no stray arc), "horizon" is named inside its
   circle, the photon sphere from its free left side, and the circling ray gets "circles, then escapes". ISCO:
   two paths only, at a larger scale — a closed circular orbit at 4.5 rₛ ("stays in orbit") and a spiral from
   2.95 rₛ that falls in after ≈ 1.3 turns ("spirals in", in the path's ember colour), one dashed 3 rₛ ring.
3. **The payoff made our render read as the M87\* photograph; the frame was all blur.** → The blur wipe now stops
   at the centre: the payoff ends side by side, sharp on the left, EHT resolution on the right, with a still
   hairline seam and two plain labels. The caption is "Our render, blurred to EHT resolution." throughout;
   M87\* appears only in the mono line, which starts "M87\* (EHT 2019, not shown):". The moving wipe dividers
   (a translucent motion-blurred bar) were removed from the Doppler and telescope wipes; the image's own soft
   edge is the wipe.
4. **Exposure and grade not locked: cream wash in some beats, mud in others, flat clipped patches.** → Two
   changes to the image pipeline. (a) Highlight compression of the disk light only (sky untouched): above a
   pivot its luminance is compressed in log space (power 0.6) with chromaticity kept, so the Doppler-bright side
   stays textured yellow-white instead of clipping — the physical range across the disk is ≈ 12 stops. (b) A
   warm-only mid-tone saturation of +85 % (was +28 % for every hue), so the dim, cooler gas reads as ember
   orange rather than brown, and starlight stays pale. Exposures re-measured: no clipped white in any beat, p99
   ≈ 0.75–0.92, mean ≈ 20–50 (0–255) for disk-filled frames (ISCO 8.4 → 5.2, photon ×0.8, close orbit ×1.4 so
   the blueshifted band reads white-hot, not grey). The end card no longer dims the whole picture (which made it
   mud brown with a raised black): the ring sits small, whole and crisp above the title.
5. **Disk texture looked like a Photoshop filter** (radial zoom / twirl, wood grain, brushed ribbon). → Shear
   lifetime of each turbulence layer cut from 210 M to 120 M (stretch near the ISCO bounded at a few : 1), a
   mid-scale clump layer elongated ≈ 2 : 1 along the orbit, sparse thin dark filaments gated by the clumps
   (cooler and more transparent gas), stronger temperature contrast (hot knots read yellow-white, lanes deep
   orange), and an outer rim that tapers smoothly instead of being cut ragged by the noise.

Also from round 3: lensed stars are drawn with motion blur (180° shutter). As the camera circles the hole the
lens map turns with it, so the sky seen through a pixel turns by the camera's angular step; mapped through the
exact lens Jacobian this gives each star image's streak, which is drawn as a swept Gaussian (flux kept) — near
the Einstein ring stars now streak instead of strobing. The brightest stars get a soft glow. Grain raised to
≈ 1–1.5 % in the mid-tones. Copy: "Gas coming toward you: up to 81× brighter." (81 from (g₊/g₋)⁴, computed);
"Doppler left out on purpose, per Thorne’s team."; ISCO readout "orbital speed 0.500 c / its clocks run 29% slow"
(√(1 − 3M/r) at the ISCO, computed). The contact sheet's timestamps moved to a band under each tile (they had
covered the bottom-left readouts, which the reviewer read as a "decode" glitch).

### Round 4 — five worst findings and what was done

1. **The Doppler with/without wipe had no labels and read as a glitch.** The reviewer asked for a parked split;
   but a split through a centred hole would set the approaching side of one version beside the receding side
   of the other, which shows a false asymmetry. → The whole frame now *morphs* between the two (67.2–69.2 s and
   back at 73.6–75.6 s): the bright side calms and the dim side lifts, with the headline "How Interstellar
   showed it" and the caption "Doppler left out, on purpose." over the no-Doppler view, and the Doppler view
   introduced by "One side is brighter" with side readouts tied to each side by leader lines
   ("approaching ≈ 4× brighter", "receding ≈ 20× dimmer": g⁴ for g = 1.41 and 0.47, whose ratio is the 81× in
   the caption). Text appears only after the camera settles (62.6 s). "per Thorne’s team" dropped from the
   screen (the reference stays in SOURCES.md).
2. **A 15-word monospace payoff caption.** → Two captions of ≤ 8 words: "Our render, blurred to EHT resolution."
   then "The real M87* (2019): brighter below too." The µas/mass line is gone from the screen. The halves are
   named "sharp" / "EHT resolution" right under the ring, either side of the seam; the seam hairline was removed
   (the Lanczos downscale gave it dark ringing). The payoff camera moved back (345–380 M → 410–450 M) so the
   ring clears the captions.
3. **Face-on disk texture like hair or fur.** → Filaments made broad, soft and smooth along the flow and cut to
   about 40 % of their round-3 strength; the round "blob" knots elongated ≈ 3 : 1 along the orbit and weakened.
4. **A dark halo on every glyph, fading in ahead of the letters.** → No glyph halo at all. Instead the composite
   darkens the picture by 28 % under each text block (soft-edged, following the text's own fade) and hides the
   stars there, so no star sits in a word.
5. **Diagrams colliding with the render and the frame edge; faint rays.** → The gravity diagram was rebuilt to
   fit x 1330–1810 (observer at 30 M, outside the drawn disk's rim as in the shot, so the under-the-hole images
   exist; disk drawn to 18 M), ≥ 80 px clear of the real disk; the observer is a dot labelled "you"; rays that
   loop round the hole are excluded; five rays, 2.6 px, full ember. Photon diagram: three rays (the critical one
   at 3 px white, one that falls in, one that escapes, 2.4 px). The layout check now enforces title-safe
   (x 96–1824, y 54–1026).

Also from round 4: the ISCO ring is broken where its "3 rₛ" label sits on it (no doubt which circle it names);
one ISCO readout line ("orbital speed 0.5 c"); the gravity readout removed (too much text per screen); close
orbit text held 5 s; star motion blur at a 90° shutter with long streaks faded further (they read as rain or
scratches); star colours mostly F/A/B; star gain +30 %; the black floor raised to ≈ 2.3/255 with more grain so
the encode will not band; the gravity FOV 34° → 36° so the hot side sits a little further inside the frame.

### Round 5 — five worst findings and what was done

1. **The close-orbit text stayed on screen over the next shots (1:28–1:32).** This was a real bug, not timing:
   the cue ends at 85.9 s, but when the text layer was completely empty the 2D canvas could hand WebGL a stale
   snapshot of the last frame that had text. → The overlay now reports when it drew nothing and the text pass is
   skipped on those frames, so an empty frame can never show old text.
2. **The photon-sphere diagram was a tangle.** → 1.3× larger and re-centred; the readout under it removed; the
   neighbour rays moved to 0.9 and 1.15 × √27 M so the three approach paths are ≥ 25 px apart; the dashed photon
   sphere is faint so the circling ray (3.2 px white, with a comet head while it laps) is what reads; the rays are
   told apart by weight and dash and each is named, echoing the caption: "circles", "escapes" (dashed ember) and
   "falls in" (ember, set inside the horizon next to where that ray ends). The label value "1.5 rₛ" comes from the
   numerical photon-sphere search.
3. **Three Doppler multipliers a first-time viewer cannot reconcile (81×, 4×, 20×).** → One number: "Approaching
   side: up to 81× brighter than receding." The side labels are just "approaching" / "receding", and their leaders
   end on a dot in the dark sky just above the disk instead of vanishing into it.
4. **Ghost arcs showing through the near side of the disk.** Round 3's outer taper made the outer half of the disk
   translucent, so the lower photon ring and secondary images showed through it while the texture streamed past.
   → Only the outer rim (r > 0.72 r_out) turns translucent now.
5. **Units and readouts too small.** → Subscripts and superscripts at 76 % of the base size (was 64 %); readouts
   36 px; duplicated and over-precise numbers removed (the photon readout is gone; ISCO "0.5 c").

Also from round 5: the payoff ring is smaller (camera 560–620 M) so the captions and half labels have clear space;
second payoff caption "Like M87* (EHT, 2019): brighter at the bottom." (the render's bottom half is measurably
brighter, as in the 2017 EHT image); the right-hand column starts at x = 1200 in both the gravity and ISCO beats,
and no diagram passes x = 1800; the gravity rays are 3 px; the ISCO ring label moved to where the spiral is
furthest inside it; grain in the blacks raised a little. Not changed: the three type families. The brief asks
for two @fontsource typefaces plus a monospace, and the mono is kept only for the numeric readouts.

### Round 6 — five worst findings and what was done

1. **Photon diagram: a "doubled circle" and a label pair that read as one sentence.** The circling ray only
   approaches r = 3M asymptotically, so it drifted 10–12 px off the dashed guide. → The guide is gone: the
   circling ray itself traces the photon sphere and carries the "photon sphere, 1.5 rₛ" label; "falls in" is the
   only word inside the hole (no "horizon" stacked above it); the escaping ray is a cream dashed line, so orange
   means only "falls in".
2. **The film ended on a lit frame.** → Within the brief's 3 s card: title and credit are in by 105.4 s, held, and
   picture and type fade out together (107.25–107.85 s) to true black for the last frames.
3. **Payoff caption ahead of the picture; raw seam.** → The caption now starts with the blur wipe (95.2 s); the
   seam carries a soft cream hairline (built from three soft strokes so the 2× Lanczos downscale cannot ring)
   running just past the disk; "sharp" and "EHT resolution" are centred under their halves.
4. **Doppler side labels in the monospace, 1 px leaders, dots on the haze.** → Labels in Jost at caption size,
   2 px leaders, end dots with a dark rim placed on the white-hot left side and the dim right side.
5. **Close-orbit card: too much text for its time, with ticking numbers.** → On screen ≈ 6.5 s (from 79.4 s);
   the distance row dropped; the two remaining values are those at the closest point of the orbit (computed from
   the camera path), so nothing ticks while you read.

Also from round 6: the return morph gets its own headline ("And back to the real view"); the gravity diagram is
lifted 70 px, away from the rendered disk's wing; the title kerns I–N a little tighter.

### Round 7 — five worst findings and what was done

1. **The photon beat never showed light orbiting** (the lap was drawn in about a second, alongside the other
   rays, and merged into a static circle). → The circling ray now has its own timing, shared with the score:
   approach 0.8 s, then 1.8 laps at an even pace over 3 s while it is alone on screen, drawn as a faint path with a
   bright fading trail and a glowing head, over a thin dashed photon-sphere reference; only then do the
   neighbours branch off ("falls in", "escapes"), and the circling ray is named at its end ("orbits, then
   leaves"). "Here, light itself can orbit." runs through the lap, "One nudge: it falls or escapes." over the
   branches; the interlude is 1 s longer.
2. **The close-orbit headline was cut by the photon ring at 80 s.** → The text now arrives at 81.3 s, after the
   camera's swing, when the lower-left is inside the shadow.
3. **Mushy foreground disk.** The texture filter used the longest axis of each pixel's footprint, which on the
   grazing near disk is many times the short axis. → It now uses a footprint between the area-equivalent and the
   longest axis, with a smaller safety factor, so the near disk keeps its finer octaves.
4. **Stars strobing or drawn as dashes in the wrong direction.** The blur used only the camera's rotation about
   the hole. → The sky motion behind each pixel now has three exact parts: the rotation about the hole (the lens
   map turns with it), the camera's own turn relative to that (a rigid image shift carried by the pixel
   Jacobian), and its change of distance, from a second Jacobi field integrated with the ray (the orbit's
   derivative with respect to the camera radius at a fixed local angle). Verified with an exaggerated shutter:
   each streak runs from the star's position one frame earlier to its position one frame later. 180° shutter.
5. **Text scrims erased the rendered disk.** → The full-height column scrims are gone; only the per-text plates
   (soft, −28 %) and a soft local scrim under the ISCO diagram remain, so the disk no longer shrinks when text
   arrives.

Also from round 7: payoff labels hung off the seam at equal gaps and a tighter split; "And back to the real view"
held for 2 s at full strength; leader end markers drawn the same on bright and dim disk; the warmest stars now
start at 5200 K (no orange stars).

### Round 8 — the reviewer found nothing structural; the remaining findings and what was done

1. **"And back to the real view" never reached full strength in the 2 s samples.** → Held at 100 % for ≈ 1.8 s
   with the standard fades.
2. **The near disk in the Doppler shot had the least fine detail on screen.** → The streak noise gained two finer
   octaves, used only where the pixel footprint is small enough (octaves already filtered away are skipped, so
   distant hits cost nothing extra).
3. **Photon diagram end state: the lap trace ran 6–12 px off the dotted sphere; "falls in" 25 px from its ray.**
   → Once the lap is done the true photon sphere becomes a solid 2 px circle and the lap drops to a light trace
   under it; "falls in" sits right at the end of the orange ray.
4. **ISCO diagram end state: the 3 rₛ circle was the faintest stroke and the spiral ran just inside it.** → The
   3 rₛ circle is solid and the strongest stroke (the stable orbit is lighter); the plunging matter now starts at
   2.6 rₛ with the ISCO's own angular momentum, clearly inside the circle (≈ 1.3 turns to the horizon); "spirals
   in" is set below the diagram on a leader from the spiral.
5. **"Interstellar" in roman.** → Set in Cormorant italic (titles are italic), with a small markup in the text
   renderer.

Also: the payoff blur wipe now starts at the ring's right edge and fades in, so it is visibly under way when its
caption lands; the end-card lockup moved down ≈ 55 px; one leader end-marker style; thinner gravity rays where they
converge on the observer.

### Round 9 — remaining findings and what was done

1. **Photon diagram: the photon sphere drawn twice, out of register.** The critical ray only approaches r = 3M
   asymptotically, so its lap and any reference circle can never coincide exactly. → The dashed reference now
   guides the eye only during the lap and fades out as the lap completes; the ray's own trace is the single circle
   that stays (labelled "photon sphere, 1.5 rₛ"). "falls in" names the orange ray on its way in, outside the loop.
2. **The payoff caption switched to italic at "(EHT" and dropped the asterisk from M87\*.** A real bug: the
   round-8 italic markup used "\*", which is part of the black hole's name. → The markup is now "_title_"; the
   caption reads "Like M87\* (EHT 2019): brighter at the bottom." in roman.
3. **Doppler / Interstellar captions resting on the arc glow (4 px clear).** → That text block moved up 40 px.
4. **The ISCO diagram read as a bullseye in a held frame.** → The plunging path is drawn faint at its start and
   full at the horizon and ends on an ember dot where it falls in; a particle keeps circling the stable orbit until
   the beat ends.
5. **Stars as hard 1 px dashes; a few long streaks reading as scratches.** → Streaks are slightly softer across
   (up to 1.45× the star size), taper toward their ends, and long ones are faded more strongly.

Also: the first payoff caption now lands at 96.0 s, when the blur is visibly under way; the Doppler leaders carry
a dark keyline so they hold on the white-hot disk.
