# FALL IN — Storyboard

**Logline.** One continuous flight toward, around and back out from a non-spinning black hole, rendered
by actually tracing light along curved spacetime, asking a single question: *what would you actually see?*

**Format.** 1920×1080, 30 fps, 108 s. One unbroken camera flight (no cuts), eased between composed hero
shots. Every frame is a pure function of time `t`.

**Units on screen.** Distances in Schwarzschild radii, `rₛ = 2GM/c²`. Inside the renderer `G = c = M = 1`,
so `rₛ = 2`.

---

## Beat sheet

| # | Beat | Time | Hero shot (camera) | On-screen text | Music / sound hit points |
|---|------|------|--------------------|----------------|--------------------------|
| 0 | **Hook** | 0:00–0:07 | Black → stars. Slow eased push-in from 170 M to 82 M, 4° above the disk plane, hole centred. The background stars stream outward and pile into an Einstein ring around the shadow. | Question (serif italic): *What would you actually see?* (1.2–5.9 s) | Sub-bass drone fades up from silence. First heartbeat at 1.0 s (60 bpm). Rising air from 3.6 s. |
| 1 | **Title** | 0:07–0:13 | Push-in continues to 54 M; the disk's far side starts to arch over the shadow. | **FALL IN** (Cormorant Garamond 500, moderate tracking), 7.0–12.3 s | **7.0 s:** low boom on the heartbeat; pad enters, motif stated once (D–A–B♭–F–E). |
| 2 | **Gravity bends light** | 0:13–0:30 | Near edge-on (85° from the axis), 47 → 42 M. Hole on the left; the disk crosses in front, its far side bent up over the top and down under the bottom. The right third is sky: headline, captions, a side-view diagram of the actual light paths (same equations) and the readout live there. | *Gravity bends light* · "You’re seeing the disk’s far side." / "Bent over the top, and under." · diagram labels "to you", "far side of the disk" · readout distance / "time runs 2.3% slower" | **13.0 s:** chord progression starts (Dm9 → B♭maj7 → Gm9 → Asus4). Soft tick when each diagram ray reaches you. |
| 3 | **Photon sphere** | 0:30–0:49 | Closer (36 → 31.5 M), 74°, slow orbit; the thin photon ring separates from the disk. At 37 s the shot cools out to black for a full-frame top-view diagram traced in u(φ): the critical ray (b = √27 M (1 + 2.8 × 10⁻⁷)) laps the photon sphere ≈ 1.9 times alone, then two neighbours branch off — one falls in, one escapes. | *The photon sphere* · "Here, light itself can orbit." / "One nudge: it falls or escapes." · labels "photon sphere, 1.5 rₛ", "falls in", "orbits, then leaves", "escapes" | **30.0 s:** glassy tone that pans around the stereo field in step with the circling ray. |
| 4 | **Innermost stable orbit** | 0:49–1:00 | From 38° off the axis, 34 → 31 M, hole on the left: the dark gap between the shadow and the disk's sharp inner edge. Right column over the dim, receding side: a top-view diagram of a stable circular orbit (5 rₛ) and matter released at 2.6 rₛ spiralling in (timelike geodesics), with a dashed 3 rₛ reference ring. | *The last stable orbit* · "Inside 3 rₛ, matter plunges in." · legend "stays in orbit" / "spirals in", ring label "3 rₛ" · readout orbital speed 0.5 c | **46.0 s:** register drops; a rising chirp as the diagram's particle spirals in (its orbital frequency climbs), a low thump at the horizon. |
| 5 | **Doppler beaming** | 1:00–1:16 | Almost edge-on (86°), 24 → 22 M, hole centred. The approaching (left) side is white-hot, the receding side deep orange. At 66.6 s a soft wipe crosses the frame and leaves the disk as Interstellar showed it (no frequency shifts); at 73 s it wipes back. | *One side is brighter* · "Approaching side: up to 81× brighter than receding." · labels "approaching" / "receding" · then *How _Interstellar_ showed it* · "Doppler left out, on purpose." → "Now back to the real view." | **60.0 s:** chords brighten. Doppler pass-by whoosh tied to each wipe. |
| 6 | **Close orbit** | 1:16–1:30 | Dive to 1.7 rₛ, just outside the photon sphere, looking up along the shadow's edge: the shadow covers the lower frame, the disk is a white-hot band, starlight is blueshifted. **Closest point at 1:26.** Then a fast pull-back. | *Just outside the photon sphere* · "The shadow covers ≈ 40% of the sky." · readout time runs 36% slower / starlight 1.56× bluer (at the closest point) | Heartbeat slows toward the closest point. **86.0–87.0 s: one second of silence.** **87.0 s:** wide swell. |
| 7 | **Payoff** | 1:30–1:45 | Far back (560 → 620 M), 17° from the axis — the angle we see M87* at, rolled so the bright side is at the bottom. A soft wipe blurs the right half to the EHT's resolution (≈ 20 µas beam on a 42 µas ring) and stops at the centre: sharp on the left, telescope view on the right. | *What a telescope would see* · "Our render, blurred to EHT resolution." → "Like M87* (EHT 2019): brighter at the bottom." · labels "sharp" / "EHT resolution" | **90.0 s:** motif returns in octaves over the swell; a glassy shimmer as the blur arrives. |
| 8 | **End card** | 1:45–1:48 | The ring, small, whole and sharp, above the title; picture and type fade together to black. | **FALL IN** · "Made by @vivekst1 with Claude Opus 5.5 from one prompt" | **105.0 s:** final D chord, reverb tail to 108 s. |

This table describes the film as built; how it got here from the first plan (and why) is logged in
`DECISIONS.md`, including every review round.

The camera never stops dead: each hero shot has a slow drift (orbit or dolly) and the moves between
them use C¹-continuous cubic easing so speed changes are smooth.

## Palette (4 colours, one grade)

| Role | Colour | Hex |
|------|--------|-----|
| Void | near-black | `#030304` |
| Ember (cool disk edge, diagram rays) | blackbody ≈ 2000 K orange | `#FF8A3D` |
| White-hot (text, hottest disk) | warm white | `#FFF3E3` |
| Starlight (readouts, faint labels) | blue-white | `#BFD4FF` |

Grade: highlight compression of the disk light, ACES filmic, warm-only mid-tone saturation (ember stays orange,
starlight stays pale), a ~1.5/255 filmic black with grain, highlights path to warm white.
No purple/blue gradients, no frosted glass, no cards.

## Type

* **Headlines & title** — Cormorant Garamond 500 (italic 400 for the question), headlines 64 px, question 70 px,
  title 150 px.
* **Captions, labels & credit** — Jost 400, captions 38 px, diagram labels 36 px, credit 34 px.
* **Readouts** — IBM Plex Mono 400, 34 px.

All text is drawn on its own 2D canvas above the WebGL canvas, never blurred; captions ≤ 8 words and held
long enough to read twice (≥ 4 s fully visible).

## Music plan

Key: D minor, ending on D major. Sub-bass drone on D1 (36.7 Hz) throughout, slowly evolving detuned pads
(filter and chord motion), a soft heartbeat-like "lub-dub" pulse whose tempo is the film's clock: 60 bpm for
the first minute (so beat hits land on whole seconds), slowing to ~34 bpm on the dive, stopping for one second
of silence at the closest point (86–87 s), then a wide swell. Structure: intro (0–13) → build (13–76) →
peak (76–98, through the silence and the swell) → resolve (98–108). Original motif D–A–B♭–F–E.
Sound effects tied to on-screen events (title boom, panel ticks, circling tone, plunge glide, Doppler pass-by,
dive rumble). Generated convolution reverb, stereo widening, mastering to −14 LUFS / < −1 dBTP.
