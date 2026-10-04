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
