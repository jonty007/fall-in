# Sources

Every name, number and date that appears on screen is listed here with where it comes from. Physics values shown
on screen are **computed live from the formulas** in `film/src/physics.js` (e.g. the photon-sphere radius is found
numerically as the maximum of the photon effective potential); the references below are what those numbers were
checked against.

Fact-checking was done with web search on 2026‑10‑04. Direct page fetches were blocked by the build environment's
network policy, so quotations from the Interstellar paper are taken from search-engine extracts of the arXiv PDF
(consistent across several extracts). The wording used on screen ("Interstellar left this out, on purpose.") relies
only on the paper's plainly stated point that Nolan and Franklin *chose to omit the Doppler shifts*.

## Black-hole physics (Schwarzschild, non-spinning)

| On screen | Value | Source |
|-----------|-------|--------|
| Schwarzschild radius | `rₛ = 2GM/c²` | Misner, Thorne & Wheeler, *Gravitation* (1973) §31; Carroll, *Lecture Notes on General Relativity*, arXiv:gr-qc/9712019, ch. 7 |
| Photon sphere | `r = 3GM/c² = 1.5 rₛ`, unstable circular light orbits | Bardeen, Press & Teukolsky 1972, ApJ 178, 347; Perlick & Tsupko 2022, Phys. Rep. 947, 1 (arXiv:2105.07101) |
| Shadow size | critical impact parameter `b = √27 GM/c² ≈ 2.598 rₛ` | Synge 1966, MNRAS 131, 463; Perlick & Tsupko 2022 |
| Shadow seen by a static observer | `sin α = (√27 M / r)·√(1 − 2M/r)`; at r = 3M the shadow fills half the sky; at r = 1.7 rₛ it covers ≈ 40 % of the sky | Synge 1966; Perlick & Tsupko 2022 (computed in `physics.js: shadowHalfAngle`) |
| Innermost stable circular orbit | `r = 6GM/c² = 3 rₛ` | Bardeen, Press & Teukolsky 1972 |
| Orbital speed at the ISCO (local static observer) | `v = c/2` | Bardeen, Press & Teukolsky 1972; follows from `v = √(M/(r − 2M))` |
| Clock rate of a static observer | `dτ/dt = √(1 − rₛ/r)` (0.64 at 1.7 rₛ) | MTW §25; Carroll ch. 7 |
| Redshift of disk light | `g = 1 / [√(1 − 2M/r_cam) · uᵗ · (1 − Ω b_z)]`, `uᵗ = 1/√(1 − 3M/r)`, `Ω = √(M/r³)`; edge-on at the ISCO g = 1.41 (approaching) and 0.47 (receding) | standard; e.g. Luminet 1979, A&A 75, 228; computed in `physics.js: diskG` |
| Brightness of shifted light | `I_ν/ν³` is invariant along a ray, so a blackbody at T is seen as a blackbody at gT; bolometric intensity ∝ g⁴ | MTW §22.6; Rybicki & Lightman 1979 §4.9 |
| Disk temperature profile | Novikov–Thorne / Page–Thorne thin disk, zero torque at the ISCO, `T ∝ F^{1/4}`; peak at r ≈ 9.6 GM/c² | Page & Thorne 1974, ApJ 191, 499; Novikov & Thorne 1973 (in *Black Holes*, eds. DeWitt & DeWitt); closed form for a = 0 checked numerically against the integral (agreement to 10⁻⁵) — see `physics.js` |

## Interstellar

* O. James, E. von Tunzelmann, P. Franklin, K. S. Thorne, "Gravitational lensing by spinning black holes in
  astrophysics, and in the movie *Interstellar*", *Classical and Quantum Gravity* **32**, 065001 (2015),
  doi:10.1088/0264-9381/32/6/065001, arXiv:1502.03808.
  * Introduction (roadmap): the paper explains "why Christopher Nolan and Paul Franklin chose to omit the Doppler
    shifts in the movie". Figure 15(a) is the movie-style disk with no frequency shifts; 15(b) adds the colour
    shifts; 15(c) adds the intensity (beaming) shifts, making the approaching left side very bright and the
    receding right side very dim.
  * The movie images use spin a/M = 0.6 (the story needs a/M ≈ 1); our film's hole is non-spinning.
* *Interstellar* (2014), dir. Christopher Nolan; Kip Thorne was executive producer and science adviser.
* Supporting: J.-P. Luminet, "The Warped Science of Interstellar", arXiv:1503.08305 (2015) — "a conscious decision
  was made to leave out the Einstein and Doppler shifts".
* EHT FAQ, "How realistic are movie depictions of black holes, e.g. Interstellar?" —
  https://eventhorizontelescope.org/faq/how-realistic-are-movie-depictions-black-holes-eg-interstellar

## M87* (Event Horizon Telescope)

| On screen | Value | Source |
|-----------|-------|--------|
| First image published | 10 April 2019 | EHT Collaboration 2019, Paper I, ApJL 875, L1 (arXiv:1906.11238); ESO press release eso1907 |
| Observations | 5, 6, 10, 11 April 2017, at 1.3 mm (≈ 230 GHz) | Paper I |
| Ring diameter | 42 ± 3 µas ("≈ 42 µas") | Paper I |
| Mass | (6.5 ± 0.7) × 10⁹ M☉ ("≈ 6.5 billion Suns") | Paper VI, ApJL 875, L6 (arXiv:1906.11243) |
| Distance | 16.8 ± 0.8 Mpc ≈ 55 million light-years | Paper I / VI |
| Appearance | an asymmetric bright ring around a central brightness depression; brighter in the south (bottom) in 2017 | Paper I |
| Why one side is brighter | "relativistic beaming of the emission from a plasma rotating close to the speed of light" | Paper I; Paper V, ApJL 875, L5 |
| Viewing angle | jet ≈ 17° from the line of sight | Walker et al. 2018, ApJ 855, 128 (arXiv:1802.06166); adopted in Paper V |
| Resolution used for the blur | ≈ 20 µas effective (≈ 25 µas nominal λ/D) | Paper I / ESO press release |

Notes we respect on screen: the EHT image is radio data in false colour, so the comparison is about *shape* only;
our hole does not spin, M87* probably does; the 2018 image's brightest region moved ≈ 30°.

## Methods and code references

* CIE 1931 2° colour matching functions, analytic multi-lobe fit: C. Wyman, P.-P. Sloan, P. Shirley,
  "Simple Analytic Approximations to the CIE XYZ Color Matching Functions", JCGT 2(2), 2013.
* XYZ → linear Rec.709 matrix: IEC 61966-2-1 (sRGB).
* AgX tone mapping (T. Sobotka) / ACES filmic approximation (S. Hill's RRT+ODT fit): see DECISIONS.md for the one used.
* "Starless" style planar-orbit integration and the Binet photon equation `u'' + u = 3Mu²`: standard result, e.g.
  Chandrasekhar, *The Mathematical Theory of Black Holes* (1983) §20.
* Fonts (SIL Open Font License), from npm via @fontsource: Cormorant Garamond (Christian Thalmann), Jost (Owen Earl),
  IBM Plex Mono (IBM).
