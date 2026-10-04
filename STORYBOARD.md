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
| 0 | **Hook** | 0:00–0:07 | Black → stars. Slow eased push-in from 140 M to 60 M, 5° above the disk plane, hole centred. The background stars visibly stream outward and pile into an Einstein ring around the shadow. | Headline (serif italic): *What would you actually see?* (1.2–5.6 s) | Sub-bass drone fades up from silence. First heartbeat at 1.0 s (60 bpm). Rising air from 4.5 s. |
| 1 | **Title** | 0:07–0:13 | Push-in continues to 34 M, camera lifts to 8° above the plane; the disk's back side starts to arch over the shadow. | **FALL IN** (wide-tracked sans), 7.0–12.2 s | **7.0 s:** low boom on the heartbeat; pad enters, motif stated once (D–A–B♭–F–E). |
| 2 | **Gravity bends light** | 0:13–0:30 | Near edge-on (82° from the axis), 26 M. Hole on the left third: the disk crosses in front, its far side bent up over the top and down under the bottom. Side panel on the right traces light rays bending around the hole (top-down, same equations). | Headline: *Gravity bends light* · captions: "You're seeing the disk's far side." / "Bent over the top, and under." · live readout `r = … rₛ` | **13.0 s:** chord progression starts (Dm9 → B♭maj7 → Gm9 → Asus4). Soft tick when each panel ray completes. |
| 3 | **Photon sphere** | 0:30–0:46 | Closer (14 M), 76°, slow orbit; lens tightens on the shadow edge so the thin photon ring separates from the disk. Side panel: a ray with impact parameter just above √27 M circles the hole twice at 1.5 rₛ, then escapes. | Headline: *The photon sphere* · "Here, light itself can orbit." / "One nudge: it falls or escapes." · readout `r_photon = 1.500 rₛ (numerical)` | **30.0 s:** glassy tone that pans around the stereo field in step with the circling ray. |
| 4 | **Innermost stable orbit** | 0:46–1:00 | Camera rises to 58° from the axis, 18 M: the dark gap between the shadow and the disk's sharp inner edge reads clearly. Side panel: two particle orbits from the timelike geodesic equation — a stable rosette at 3.4 rₛ and a plunge from 2.9 rₛ. | Headline: *The last stable orbit* · "Inside 3 rₛ, matter plunges in." · readouts `r_ISCO = 3.000 rₛ (numerical)`, `v = 0.500 c` | **46.0 s:** register drops; falling pitch glide when the panel particle plunges. |
| 5 | **Doppler beaming** | 1:00–1:16 | Almost edge-on (86°), 22 M, hole centred. A vertical wipe moves across the frame: left of it the disk is rendered *without* Doppler shift/beaming (the Interstellar choice), right of it *with* it. The approaching left side flares blue-white, the receding side sinks into deep orange. | Headline: *One side is brighter* · "The side moving toward you is brighter." / "Interstellar left this out, on purpose." · citation (mono) · readouts `g = 1.41 / 0.47` | **60.0 s:** chords brighten (F major colour). Doppler pass-by whoosh tied to the wipe. |
| 6 | **Close orbit** | 1:16–1:30 | Dive to 1.7 rₛ, just outside the photon sphere, sweeping sideways around the hole. The shadow swallows ≈ 40 % of the sky; the stars are crushed into thin concentric rings; starlight is blueshifted. **Closest point at 1:26.** | Headline: *1.7 rₛ from the centre* · "The shadow covers ≈ 40% of the sky." · readouts `τ/t = 0.64`, `starlight ×1.56 bluer` | Heartbeat slows 60 → 34 bpm. **86.0–87.0 s: one second of silence.** **87.0 s:** wide swell. |
| 7 | **Payoff** | 1:30–1:45 | Pull far back (300 M), 17° from the axis — the angle we see M87* at. Split frame: left our sharp image, right the same image blurred to the Event Horizon Telescope's resolution: a lopsided glowing ring around a dark centre. | Headline: *Compare: the first real image* · "A glowing ring, brighter on one side." / "Around a dark centre: the shadow." · readout: M87* facts (EHT, 10 April 2019) | **90.0 s:** motif returns in octaves over the swell; resolves toward D. |
| 8 | **End card** | 1:45–1:48 | Black, faint ring. | **FALL IN** · "Made by @vivekst1 with Claude Opus 5.5 from one prompt" | **105.0 s:** final D chord, reverb tail to silence at 108 s. |

The camera never stops dead: each hero shot has a slow drift (orbit or dolly) and the moves between
them use C¹-continuous cubic easing so speed changes are smooth.

## Palette (4 colours, one grade)

| Role | Colour | Hex |
|------|--------|-----|
| Void | near-black | `#030304` |
| Ember (cool disk edge, diagram rays) | blackbody ≈ 2000 K orange | `#FF8A3D` |
| White-hot (text, hottest disk) | warm white | `#FFF3E3` |
| Starlight (readouts, faint labels) | blue-white | `#BFD4FF` |

Grade: AgX tone mapping, blacks kept truly black, highlights path to warm white, stars slightly cool.
No purple/blue gradients, no frosted glass, no cards.

## Type

* **Headlines** — Cormorant Garamond (300/500, italic for questions), 64–72 px.
* **Title & captions** — Jost (300/400), title 132 px with wide tracking, captions 38 px.
* **Readouts & labels** — IBM Plex Mono 400, 24–26 px.

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
