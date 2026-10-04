// Scene pass: per-pixel null geodesics in a Schwarzschild spacetime.
//
// Each ray stays in the plane through the hole spanned by the camera position
// and the ray direction. In that plane we integrate the exact photon orbit
// equation (Binet form of the null geodesic)  u'' = 3 M u^2 - u,  u = 1/r,
// with fourth-order Runge–Kutta in phi. Disk crossings happen at known phi
// (where the orbital plane meets the equatorial plane), so we land on them
// with cubic Hermite interpolation of the RK4 state; escape happens where
// u -> 0, giving the exact asymptotic direction of the ray on the sky.

export const sceneFrag = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2  uRes;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uTanHalfFov;
uniform float uTime;        // disk time in units of GM/c^3
uniform float uTpeak;       // disk peak temperature (K)
uniform float uRin;
uniform float uRout;
uniform vec4  uWipe;        // x: screen position (0..1) of the beaming split, y: softness, z: 1 = split active, w: beaming amount when no split
uniform float uDiskGain;
uniform float uStarGain;
uniform float uGalaxyGain;
uniform float uSpin;        // +1 / -1 direction of disk rotation about +y
uniform vec3  uOmega;       // the camera's rotation about the hole while the shutter is open (axis * angle, rad)
uniform vec3  uViewRot;     // the camera's turn relative to that, over the same interval (axis * angle, rad)
uniform float uDr;          // the camera's change of distance from the hole over the same interval (M)
uniform sampler2D uLut;     // row 0: blackbody, row 1: disk temperature profile

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragDisk;   // disk light only (for the telescope view)
layout(location = 2) out vec4 fragThin;   // sub-pixel lensed rings, softened in post so they draw as lines, not dots

const float PI = 3.14159265358979;
const int   MAX_STEPS = 1100;

// ---------------------------------------------------------------- hashing
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 rand3(uvec3 v) { return vec3(pcg3(v)) * (1.0 / 4294967296.0); }

// ---------------------------------------------------------------- 3D simplex noise (integer-hashed gradients)
vec3 grad3(ivec3 p) {
  uvec3 h = pcg3(uvec3(p + ivec3(4096)));
  vec3 g = vec3(h & 1023u) * (2.0 / 1023.0) - 1.0;
  return g;
}
float snoise(vec3 v) {
  const float F3 = 1.0 / 3.0, G3 = 1.0 / 6.0;
  vec3 s = floor(v + dot(v, vec3(F3)));
  vec3 x0 = v - s + dot(s, vec3(G3));
  vec3 e = step(x0.yzx, x0.xyz);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 x1 = x0 - i1 + G3;
  vec3 x2 = x0 - i2 + 2.0 * G3;
  vec3 x3 = x0 - 0.5;
  ivec3 is = ivec3(s);
  vec4 w = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  w *= w; w *= w;
  vec4 n = vec4(dot(grad3(is), x0), dot(grad3(is + ivec3(i1)), x1),
                dot(grad3(is + ivec3(i2)), x2), dot(grad3(is + ivec3(1)), x3));
  return 32.0 * dot(w, n);
}

// ---------------------------------------------------------------- lookup tables
const float BB_TMIN = 600.0, BB_TMAX = 120000.0;
vec3 blackbody(float T) {
  // returns linear Rec.709 radiance of a blackbody at T (relative to 6500 K = 1)
  float x = log(clamp(T, BB_TMIN, BB_TMAX) / BB_TMIN) / log(BB_TMAX / BB_TMIN);
  vec4 c = textureLod(uLut, vec2((x * 511.0 + 0.5) / 512.0, 0.25), 0.0);
  return c.rgb * exp2(c.a);
}
float diskProfile(float r) {
  float x = clamp((r - 6.0) / 54.0, 0.0, 1.0);
  return textureLod(uLut, vec2((x * 511.0 + 0.5) / 512.0, 0.75), 0.0).r;
}

// ---------------------------------------------------------------- accretion disk
// Turbulent emission/opacity in the co-rotating frame. Two noise layers are
// sheared by Keplerian differential rotation for a limited lifetime and
// cross-faded, so the pattern spirals and never winds up into noise.
float fbm(vec3 p, float lod) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++) {
    float fade = 1.0 - smoothstep(0.2, 0.9, lod * exp2(float(i)));  // drop octaves finer than the pixel footprint (smoothly, over ~2 octaves)
    if (fade <= 0.0) { n += a * (1.0 - pow(0.46, float(8 - i))) / (1.0 - 0.46); break; }   // the rest are filtered away
    s += a * fade * snoise(p);
    n += a;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.46;
  }
  return s / n;
}

float fbm3(vec3 p, float lod) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 3; i++) {
    float fade = 1.0 - smoothstep(0.2, 0.9, lod * exp2(float(i)));
    s += a * fade * snoise(p);
    n += a;
    p = p * 2.07 + vec3(4.1, 2.3, 7.7);
    a *= 0.55;
  }
  return s / n;
}

// x: brightness/density field, y: dark filaments (thin cool lanes between the clumps)
vec2 diskLayer(float r, float ang, float lr, float age, float seed, float lod) {
  float Om = pow(r, -1.5);
  float a = ang - uSpin * Om * age;
  vec2 cs = vec2(cos(a), sin(a));
  // large clumps and arms (roughly isotropic; Keplerian shear turns them into spirals)
  vec3 p1 = vec3(cs * 4.6, lr * 4.4 + seed * 7.31);
  float warp = snoise(p1 * 0.8 + vec3(seed));
  float big = fbm3(p1 + vec3(warp * 0.6, -warp * 0.4, warp * 0.3), lod * 0.35);
  // mid-scale clumps: the cellular, broken-up look of turbulent gas between the arms
  // (elongated ~2:1 along the orbit before any shear)
  vec3 pm = vec3(cs * 6.5, lr * 13.0 + seed * 2.9 + big * 0.7);
  float mid = fbm3(pm, lod * 0.9);
  // streaks: stretched along the orbit, displaced by the clumps
  float sa = a + 0.55 * lr;  // gentle trailing spiral pitch for the fine structure
  vec2 cs2 = vec2(cos(sa), sin(sa));
  vec3 p2 = vec3(cs2 * 7.0, lr * 6.5 + seed * 3.17 + big * 1.1);
  float streak = fbm(p2, lod);
  // fine wisps: smooth (no ridges, whose cusps alias), faded by the pixel footprint
  vec3 q = vec3(cs2 * 9.0, lr * 22.0 + seed * 5.3 + big * 2.0);
  float wisp = snoise(q) * (1.0 - smoothstep(0.2, 0.9, lod * 2.4));
  // sparse hot knots riding the flow
  // (elongated ~3:1 along the orbit, so they read as hot streaks in the flow, not round blobs)
  float knot = smoothstep(0.5, 0.88, snoise(vec3(cs * 5.0, lr * 15.0 + seed * 1.7 + big * 0.8) + vec3(9.1, 2.7, seed))) * (1.0 - smoothstep(0.2, 0.9, lod * 1.5));
  // dark filaments: ridges of a warped mid-scale field, faded out before they alias
  // (long and thin along the flow, and sparse: only the strongest ridges, gated by the clumps)
  // (broad, soft and smooth along the flow: they should read as cooler gas, not as hairs)
  vec3 pl = vec3(cs * 2.6, lr * 10.0 + seed * 4.7 + warp * 0.4);
  float ridge = 1.0 - abs(fbm3(pl, lod * 0.8) * 1.6);
  float lane = smoothstep(0.78, 0.97, ridge) * smoothstep(-0.1, 0.35, snoise(p1 * 1.3 + vec3(3.3, seed, 1.9)))
             * (1.0 - smoothstep(0.15, 0.6, lod * 1.6));
  return vec2(big * 0.9 + mid * 0.35 + streak * 0.17 + wisp * 0.05 + knot * 0.45, lane);
}

// returns rgb emission (already * alpha) and alpha
vec4 diskSample(vec3 P, float r, float cosInc, float g, float lod) {
  float ang = atan(P.z, P.x);
  float lr = log(r);
  // each turbulence layer is sheared for at most PERIOD (in M) before it is cross-faded out,
  // which bounds the stretch near the ISCO to a few : 1 (real turbulence is regenerated, not
  // wound up indefinitely)
  const float PERIOD = 120.0;
  float ph = uTime / PERIOD;
  vec2 n2 = vec2(0.0);
  float wsum2 = 0.0, wsum = 0.0;
  for (int k = 0; k < 3; k++) {
    float pk = ph + float(k) / 3.0;
    float cyc = floor(pk);
    float fr = pk - cyc;
    float w = sin(3.14159265 * fr);           // smooth window; three layers overlap
    w *= w;
    vec2 l = diskLayer(r, ang, lr, fr * PERIOD, cyc * 3.0 + float(k), lod);
    n2 += w * l;
    wsum2 += w * w;
    wsum += w;
  }
  float n = n2.x * inversesqrt(max(wsum2, 1e-4)) * 0.8; // keep the texture's contrast constant through the cross-fades
  float lane = n2.y / max(wsum, 1e-4);
  // radial structure: crisp ISCO edge, smooth outer taper (independent of the noise, so the
  // rim is soft rather than ragged)
  // inner edge filtered with the pixel footprint (coverage), so thin lensed rings don't sparkle
  float edgeW = clamp(lod * r / 13.5, 0.03, 1.5);
  float inner = smoothstep(uRin - edgeW, uRin + edgeW, r);
  float outer = 1.0 - smoothstep(uRout * 0.72, uRout, r);   // only the outer rim turns translucent
  // optically thick body (thin disks are), more translucent toward the outer edge
  float dens = inner * clamp(0.9 + 1.1 * n, 0.12, 1.8) * (1.0 - 0.25 * lane);
  float tau = 4.0 * dens / max(abs(cosInc), 0.08);
  float alpha = (1.0 - exp(-tau)) * outer;
  float T = uTpeak * diskProfile(r) * (0.9 + 0.26 * clamp(n, -1.0, 1.0)) * (1.0 - 0.06 * lane) * g;
  vec3 em = blackbody(T) * uDiskGain;
  return vec4(em * alpha, alpha);
}

// ---------------------------------------------------------------- sky
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0, -s, 0, 1, 0, s, 0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }

const vec3 GAL_N = normalize(vec3(0.5, -0.866, 0.12));   // galactic pole (band crosses behind the hole at ~30 degrees)
const vec3 GAL_C = normalize(vec3(0.62, 0.38, -0.69));  // direction of the galactic centre

float galaxyDensity(vec3 D, float lod) {
  float lat = dot(D, GAL_N);
  float cen = max(dot(D, GAL_C), 0.0);
  float band = exp(-lat * lat / (0.018 + 0.05 * cen * cen));
  float bulge = exp(-(1.0 - cen) * 9.0) * exp(-lat * lat / 0.03);
  float clouds = fbm(D * 5.0, lod * 5.0) * 0.5 + 0.5;
  float dust = 1.0 - smoothstep(0.0, 0.5, abs(fbm(D * 9.0 + 3.1, lod * 9.0))) ;
  float dl = (lat + 0.012) / 0.03;
  float dustLane = exp(-dl * dl);
  float v = (band * (0.35 + 0.9 * clouds * clouds) + bulge * 0.9) * (1.0 - 0.75 * dust * dustLane * band);
  return max(v, 0.0);
}

// Star layers: one candidate star per cell of a cube-map grid. Each star is a
// point source drawn with a pixel-space Gaussian through the local Jacobian of
// the lens map (sky direction per screen pixel), so lensed stars stay
// anti-aliased and conserve flux, and their arcs stretch correctly.
struct Lens { vec3 dx; vec3 dy; float area; float ok; float scale; vec3 dD; };   // scale: pixels per Jacobian step; dD: sky motion over the shutter

vec3 starLayer(vec3 D, Lens L, mat3 R, float N, float prob, float mMin, float mMax, uint layer, float gal, float gsky, out float lodW) {
  vec3 d = R * D;
  vec3 a = abs(d);
  uint face; vec2 uv; float m;
  if (a.x >= a.y && a.x >= a.z) { face = d.x > 0.0 ? 0u : 1u; uv = d.yz / a.x; }
  else if (a.y >= a.z)          { face = d.y > 0.0 ? 2u : 3u; uv = d.xz / a.y; }
  else                          { face = d.z > 0.0 ? 4u : 5u; uv = d.xy / a.z; }
  vec2 w = atan(uv) * (4.0 / PI);
  vec2 gcell = (w * 0.5 + 0.5) * N;
  vec2 cell = floor(gcell);
  float cellAng = (PI * 0.5) / N;
  float foot = sqrt(L.area) / L.scale;
  lodW = smoothstep(0.10, 0.32, foot / cellAng) ;
  vec3 rnd = rand3(uvec3(uvec2(cell), face * 16u + layer));
  vec3 rnd2 = rand3(uvec3(uvec2(cell) + 7919u, face * 16u + layer + 101u));
  float p = min(prob * (1.0 + 3.0 * gal), 1.0);
  if (rnd.x > p || lodW >= 1.0) return vec3(0.0);
  vec2 sw = (cell + 0.25 + 0.5 * rnd.yz) / N * 2.0 - 1.0;
  vec2 suv = tan(sw * (PI / 4.0));
  vec3 sd;
  if (face < 2u)      sd = vec3(face == 0u ? 1.0 : -1.0, suv.x, suv.y);
  else if (face < 4u) sd = vec3(suv.x, face == 2u ? 1.0 : -1.0, suv.y);
  else                sd = vec3(suv.x, suv.y, face == 4u ? 1.0 : -1.0);
  vec3 S = transpose(R) * normalize(sd);
  vec3 delta = S - D;
  // least-squares pixel offset p:  J p = delta, with a tiny regulariser (finite star size)
  float a11 = dot(L.dx, L.dx), a12 = dot(L.dx, L.dy), a22 = dot(L.dy, L.dy);
  float eps = 1e-12;
  a11 += eps; a22 += eps;
  float det = a11 * a22 - a12 * a12;
  vec2 rhs = vec2(dot(L.dx, delta), dot(L.dy, delta));
  vec2 pp = vec2(a22 * rhs.x - a12 * rhs.y, a11 * rhs.y - a12 * rhs.x) / det * L.scale;   // offset in pixels
  // motion blur (180-degree shutter): L.dD is how the sky seen through this pixel moves while the
  // shutter is open; through the local Jacobian that moves the star's image by mv pixels. Near the
  // Einstein ring the magnification makes this a streak; the star is drawn as a Gaussian swept
  // along it (flux conserved), so it streaks along its real path instead of strobing.
  vec3 dD = L.dD;
  vec2 rv = vec2(dot(L.dx, dD), dot(L.dy, dD));
  vec2 mv = vec2(a22 * rv.x - a12 * rv.y, a11 * rv.y - a12 * rv.x) / det * L.scale;
  float ml = length(mv);
  if (ml > 48.0) mv *= 48.0 / ml;               // caustics: the Jacobian is near-singular; cap the streak
  ml = min(ml, 48.0);
  float tc = ml > 1e-3 ? clamp(-dot(pp, mv) / (ml * ml), -0.5, 0.5) : 0.0;
  pp += tc * mv;
  float taper = 1.0 - 0.75 * smoothstep(0.25, 0.5, abs(tc)) * smoothstep(2.0, 8.0, ml);   // streaks fade toward their ends
  // brightness: number counts N(<m) ~ 10^(0.6 m)
  m = clamp(mMax + log(max(rnd2.x, 1e-6)) / (0.6 * log(10.0)), mMin, mMax);
  float flux = pow(10.0, -0.4 * m);
  // colour temperature: mostly K/G/F, some A/B
  float t = rnd2.y;
  float T = t < 0.15 ? mix(5200.0, 5900.0, t / 0.15) : (t < 0.65 ? mix(5800.0, 9500.0, (t - 0.15) / 0.5) : mix(9500.0, 26000.0, pow(max((t - 0.65) / 0.35, 0.0), 1.4)));
  vec3 bbBase = blackbody(T);
  vec3 bb = blackbody(T * gsky);
  float lum = dot(bbBase, vec3(0.2126, 0.7152, 0.0722));
  vec3 col = bb / max(lum, 1e-6);           // flux scales with the blueshifted spectrum
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.85);
  float r2 = dot(pp, pp);
  const float SIG = 1.25;                       // point-spread in render pixels (~0.6 px after the 2x downscale)
  // (streaks much longer than the star are faded further: fast lensed images read as scratches)
  // (a streak is also a little softer across, so it is not a hard 1 px line after the downscale)
  float sg = SIG * (1.0 + 0.45 * smoothstep(2.0, 16.0, ml));
  float core = exp(-0.5 * r2 / (sg * sg)) / (2.0 * PI * sg * sg) / (1.0 + ml / (2.5066 * sg)) / (1.0 + ml * ml / 160.0) * taper;
  // the few brightest stars get a soft glow (lens scatter), so the field has a hierarchy
  float halo = exp(-0.5 * r2 / 36.0) / (2.0 * PI * 36.0) * 0.16 * smoothstep(2.0, -1.0, m) / (1.0 + ml / 15.0);
  float area = max(L.area / (L.scale * L.scale), 1e-16);   // solid angle per render pixel after lensing
  // brightness normalised to a 1080p pixel of the current lens, so stars look the same at any zoom
  float ref = 2.0 * uTanHalfFov / 1080.0;
  return col * flux * (core + halo) * (ref * ref / area) * (1.0 - lodW);
}

// mean radiance of a star layer (for cells smaller than the pixel footprint)
float layerMean(float prob, float mMin, float mMax, float N) {
  float Ef = 3.0 * pow(10.0, -0.4 * mMax) - 2.0 * pow(10.0, 0.2 * mMin - 0.6 * mMax);
  float cellAng = (PI * 0.5) / N;
  float ref = 2.0 * uTanHalfFov / 1080.0;
  return prob * Ef * ref * ref / (cellAng * cellAng);
}

vec3 sky(vec3 D, Lens L, float gsky) {
  float foot = sqrt(L.area) / L.scale;
  float gal = galaxyDensity(D, foot * 2.0);
  float gboost = dot(blackbody(5200.0 * gsky), vec3(0.2126, 0.7152, 0.0722)) / dot(blackbody(5200.0), vec3(0.2126, 0.7152, 0.0722));
  vec3 avgCol = vec3(0.93, 0.95, 1.0) * gboost;
  vec3 col = vec3(0.0);
  float lw;
  {
    mat3 R = rotX(0.31) * rotY(0.7);
    col += starLayer(D, L, R, 90.0, 0.55, -1.2, 5.5, 1u, gal * 0.4, gsky, lw);
    col += avgCol * lw * layerMean(min(0.55 * (1.0 + 3.0 * gal * 0.4), 1.0), -1.2, 5.5, 90.0);
  }
  {
    mat3 R = rotX(-0.83) * rotY(2.1);
    col += starLayer(D, L, R, 230.0, 0.75, 3.5, 8.0, 2u, gal, gsky, lw);
    col += avgCol * lw * layerMean(min(0.75 * (1.0 + 3.0 * gal), 1.0), 3.5, 8.0, 230.0);
  }
  {
    mat3 R = rotX(1.37) * rotY(-0.4);
    col += starLayer(D, L, R, 520.0, 0.85, 6.5, 10.5, 3u, gal, gsky, lw);
    col += avgCol * lw * layerMean(min(0.85 * (1.0 + 3.0 * gal), 1.0), 6.5, 10.5, 520.0);
  }
  {
    // finest layer: keeps the field dense when the lens zooms in
    mat3 R = rotX(-1.91) * rotY(1.13);
    col += starLayer(D, L, R, 1300.0, 0.8, 8.5, 12.0, 4u, gal, gsky, lw);
    col += avgCol * lw * layerMean(min(0.8 * (1.0 + 3.0 * gal), 1.0), 8.5, 12.0, 1300.0);
  }
  vec3 galCol = mix(vec3(1.0, 0.86, 0.70), vec3(0.85, 0.9, 1.0), 0.35);
  col *= uStarGain;
  col += galCol * gal * uGalaxyGain * gboost;
  return col;
}

// ---------------------------------------------------------------- one ray
// Ray differentials are exact: alongside u(phi) we integrate the Jacobi field
// j = du/dalpha (alpha = local angle of the ray from the radial direction), which obeys
// the linearised orbit equation j'' = (6u - 1) j. A screen-pixel step changes alpha
// (in-plane) and rotates the orbital plane about the camera axis (out-of-plane); from
// j we get each disk hit's footprint and the sky Jacobian per pixel, smoothly, with no
// 2x2-quad derivative steps.
struct Hit { vec3 P; vec3 D; float fp; float fl; };   // D = (r, cos incidence, g); fp = footprint (M per pixel, longest axis); fl = for texture filtering

float hermite(float s, float y0, float m0, float y1, float m1) {
  float s2 = s * s, s3 = s2 * s;
  return (2.0*s3 - 3.0*s2 + 1.0) * y0 + (s3 - 2.0*s2 + s) * m0 + (-2.0*s3 + 3.0*s2) * y1 + (s3 - s2) * m1;
}
float hermiteD(float s, float y0, float m0, float y1, float m1) {
  float s2 = s * s;
  return (6.0*s2 - 6.0*s) * y0 + (3.0*s2 - 4.0*s + 1.0) * m0 + (-6.0*s2 + 6.0*s) * y1 + (3.0*s2 - 2.0*s) * m1;
}

void trace(vec3 d, vec3 ddx, vec3 ddy, float wipe, out Hit h0, out Hit h1, out Hit h2, out int nh,
           out bool escaped, out vec3 Dsky, out vec3 Jx, out vec3 Jy, out vec3 Jr, out float bImpact) {
  float r0 = length(uCamPos);
  vec3 e1 = uCamPos / r0;
  float cosA = dot(d, e1);
  vec3 perp = d - cosA * e1;
  float sinA = length(perp);
  vec3 e2 = sinA > 1e-7 ? perp / sinA : normalize(cross(e1, abs(e1.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
  sinA = max(sinA, 1e-7);
  float f0 = 1.0 - 2.0 / r0;
  float sf0 = sqrt(f0);

  float u = 1.0 / r0;
  float w = -u * sf0 * cosA / sinA;          // du/dphi from the locally measured angle
  float b = r0 * sinA / sf0;                  // impact parameter
  bImpact = b;
  vec3  nrm = cross(e1, e2);                  // orbital plane normal (tracing direction)
  float bz = -b * nrm.y * uSpin;              // photon angular momentum along the gas motion

  // pixel step -> (d alpha, d psi) for screen x and y
  vec3 eA = -sinA * e1 + cosA * e2;
  vec2 dAl = vec2(dot(ddx, eA), dot(ddy, eA));
  vec2 dPs = vec2(dot(ddx, nrm), dot(ddy, nrm)) / sinA;
  float j = 0.0, jw = u * sf0 / (sinA * sinA); // Jacobi field and its phi-derivative
  // a second solution of the same linearised equation: the orbit's change with the camera's
  // distance r0 at a fixed local angle (u0 = 1/r0, w0 = -u0 sqrt(1-2/r0) cot A, differentiated)
  float kk = -u * u, kw = (cosA / sinA) * (sf0 * u * u - u * u * u / sf0);

  // phi of disk-plane crossings: cos(phi) e1.y + sin(phi) e2.y = 0
  float A = e1.y, B = e2.y;
  float phi0 = atan(B, A) + 0.5 * PI;
  float nextCross = mod(phi0, PI);
  if (nextCross < 1e-6) nextCross += PI;
  float nodeRate = A * nrm.y / max(A * A + B * B, 1e-6);   // d(phi_cross)/d(psi)

  float phi = 0.0;
  escaped = false;
  float phiEsc = 0.0, jEsc = 0.0, wEsc = -1.0, kEsc = 0.0;
  h0 = Hit(vec3(0.0), vec3(1.0), 0.0, 0.0); h1 = h0; h2 = h0;
  nh = 0;
  float transEst = 1.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    // step size: fine near the photon sphere, coarse far away (the equation is
    // almost harmonic there), and limited so u never changes by more than ~12 % per step
    float hb = mix(0.16, 0.017, smoothstep(0.012, 0.24, u));
    float hrel = 0.12 * u / (abs(w) + 1e-6);
    float hmin = mix(0.16, 0.0015, smoothstep(0.012, 0.05, u));
    float h = min(hb, max(hrel, hmin));

    // RK4 on (u, w, j, jw): u' = w, w' = 3u^2 - u, j' = jw, jw' = (6u - 1) j
    float k1u = w,              k1w = 3.0 * u * u - u;
    float k1j = jw,             k1jw = (6.0 * u - 1.0) * j;
    float k1k = kw,             k1kw = (6.0 * u - 1.0) * kk;
    float u2 = u + 0.5 * h * k1u, j2 = j + 0.5 * h * k1j, kk2 = kk + 0.5 * h * k1k;
    float k2u = w + 0.5 * h * k1w, k2w = 3.0 * u2 * u2 - u2;
    float k2j = jw + 0.5 * h * k1jw, k2jw = (6.0 * u2 - 1.0) * j2;
    float k2k = kw + 0.5 * h * k1kw, k2kw = (6.0 * u2 - 1.0) * kk2;
    float u3 = u + 0.5 * h * k2u, j3 = j + 0.5 * h * k2j, kk3 = kk + 0.5 * h * k2k;
    float k3u = w + 0.5 * h * k2w, k3w = 3.0 * u3 * u3 - u3;
    float k3j = jw + 0.5 * h * k2jw, k3jw = (6.0 * u3 - 1.0) * j3;
    float k3k = kw + 0.5 * h * k2kw, k3kw = (6.0 * u3 - 1.0) * kk3;
    float u4 = u + h * k3u, j4 = j + h * k3j, kk4 = kk + h * k3k;
    float k4u = w + h * k3w,    k4w = 3.0 * u4 * u4 - u4;
    float k4j = jw + h * k3jw,  k4jw = (6.0 * u4 - 1.0) * j4;
    float k4k = kw + h * k3kw,  k4kw = (6.0 * u4 - 1.0) * kk4;
    float un = u + h / 6.0 * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    float wn = w + h / 6.0 * (k1w + 2.0 * k2w + 2.0 * k3w + k4w);
    float jn = j + h / 6.0 * (k1j + 2.0 * k2j + 2.0 * k3j + k4j);
    float jwn = jw + h / 6.0 * (k1jw + 2.0 * k2jw + 2.0 * k3jw + k4jw);
    float kn = kk + h / 6.0 * (k1k + 2.0 * k2k + 2.0 * k3k + k4k);
    float kwn = kw + h / 6.0 * (k1kw + 2.0 * k2kw + 2.0 * k3kw + k4kw);

    // escape inside this step? find u = 0 on the Hermite cubic
    float sEsc = 2.0;
    if (un <= 0.0) {
      float s = u / (u - un);
      for (int it = 0; it < 4; it++) {
        float H = hermite(s, u, w * h, un, wn * h);
        float dH = hermiteD(s, u, w * h, un, wn * h);
        if (abs(dH) > 1e-12) s = clamp(s - H / dH, 0.0, 1.0);
      }
      sEsc = s;
    }

    // disk-plane crossing inside this step
    if (nextCross <= phi + h) {
      float s = (nextCross - phi) / h;
      if (s < sEsc && nh < 3) {
        float uc = hermite(s, u, w * h, un, wn * h);
        float wc = hermiteD(s, u, w * h, un, wn * h) / h;
        float jc = hermite(s, j, jw * h, jn, jwn * h);
        float rc = 1.0 / max(uc, 1e-6);
        if (rc > max(uRin - 2.0, 3.05) && rc < uRout && uc > 0.0) {
          float cp = cos(nextCross), sp = sin(nextCross);
          vec3 radial = cp * e1 + sp * e2;
          vec3 P = radial * rc;
          // local photon direction (static frame) to get the incidence angle on the disk
          vec3 tang = -sp * e1 + cp * e2;
          float drdphi = -wc * rc * rc;
          float fc = 1.0 - 2.0 / rc;
          vec3 kloc = normalize(radial * drdphi / sqrt(max(fc, 1e-4)) + tang * rc);
          float cosInc = kloc.y;
          // redshift: gas on Keplerian circular orbits, static camera at r0
          float ut = inversesqrt(max(1.0 - 3.0 / rc, 1e-4));
          float Om = pow(rc, -1.5);
          float gD = 1.0 / (sf0 * ut * (1.0 - Om * bz));
          float gNo = 1.0;   // no frequency shifts at all, as rendered for Interstellar (James et al. 2015, fig. 15a)
          // footprint of one pixel on the disk: in-plane (radial, from the Jacobi field) and
          // out-of-plane (the orbital plane turns about the camera axis, moving the hit and its node)
          vec2 inPl = abs(jc * dAl) * rc * rc;
          float arc = sqrt(rc * rc + drdphi * drdphi);
          vec2 outPl = abs(dPs) * sqrt(rc * rc * sp * sp + nodeRate * nodeRate * arc * arc);
          vec2 fxy = sqrt(inPl * inPl + outPl * outPl);
          // texture filtering uses a footprint between the area-equivalent and the longest axis: the
          // longest axis alone over-blurs the near disk, which is seen at a grazing angle
          Hit hh = Hit(P, vec3(rc, cosInc, mix(gNo, gD, wipe)), max(fxy.x, fxy.y), mix(sqrt(fxy.x * fxy.y), max(fxy.x, fxy.y), 0.35));
          if (nh == 0) h0 = hh; else if (nh == 1) h1 = hh; else h2 = hh;
          nh++;
          // conservative opacity estimate from the radial envelope, for early exit only
          float oe = 1.0 - smoothstep(uRout * 0.72, uRout, rc);
          float env = smoothstep(uRin, uRin + 0.3, rc) * oe;
          transEst *= 1.0 - env * (1.0 - exp(-3.0 / max(abs(cosInc), 0.08)));
        }
      }
      nextCross += PI;
    }

    if (sEsc <= 1.0) {
      escaped = true;
      phiEsc = phi + sEsc * h;
      jEsc = hermite(sEsc, j, jw * h, jn, jwn * h);
      kEsc = hermite(sEsc, kk, kw * h, kn, kwn * h);
      wEsc = hermiteD(sEsc, u, w * h, un, wn * h) / h;
      break;
    }
    if (un > 0.338) break;          // inside the photon sphere moving in: falls in
    if (transEst < 0.01 || nh >= 3) break;
    phi += h; u = un; w = wn; j = jn; jw = jwn; kk = kn; kw = kwn;
  }
  Dsky = escaped ? (cos(phiEsc) * e1 + sin(phiEsc) * e2) : d;
  // sky Jacobian: in-plane the escape angle moves by -j/w per unit alpha; out-of-plane the
  // asymptotic direction swings with the plane
  vec3 tEsc = -sin(phiEsc) * e1 + cos(phiEsc) * e2;
  float dPhi = -jEsc / (abs(wEsc) > 1e-6 ? wEsc : -1e-6);
  Jx = escaped ? tEsc * dPhi * dAl.x + nrm * sin(phiEsc) * dPs.x : ddx;
  Jy = escaped ? tEsc * dPhi * dAl.y + nrm * sin(phiEsc) * dPs.y : ddy;
  // escape direction per unit change of the camera's distance
  Jr = escaped ? tEsc * (-kEsc / (abs(wEsc) > 1e-6 ? wEsc : -1e-6)) : vec3(0.0);
}

vec3 shade(Hit h0, Hit h1, Hit h2, int nh, bool escaped, vec3 Dsky, Lens L, float gsky, out vec3 diskOnly, out vec3 thin) {
  vec3 col = vec3(0.0);
  thin = vec3(0.0);
  float trans = 1.0;
  for (int k = 0; k < 3; k++) {
    if (k >= nh || trans < 0.002) break;
    Hit h = h2;
    if (k == 0) h = h0; else if (k == 1) h = h1;
    float fp = clamp(h.fl, 0.0, h.D.x * 0.5);
    float lod = fp / h.D.x * 9.0 * 2.6;
    vec4 ds = diskSample(h.P, h.D.x, h.D.y, h.D.z, lod);
    // an image of the disk thinner than ~3 px (the higher-order rings) goes to the soft buffer
    float bandPx = (uRout - uRin) / max(h.fp, 1e-6);
    float tw = k == 0 ? 0.0 : smoothstep(4.0, 2.0, bandPx);
    col += trans * ds.rgb * (1.0 - tw);
    thin += trans * ds.rgb * tw;
    trans *= 1.0 - ds.a;
  }
  diskOnly = col + thin;
  if (escaped && trans > 0.003) col += trans * sky(Dsky, L, gsky);
  return col;
}

vec3 rayDir(vec2 p) { return normalize(uCamFwd + uTanHalfFov * (p.x * uCamRight + p.y * uCamUp)); }

vec3 sample1(vec2 p, vec2 pixStep, float wipe, float gsky, float pixAng, out vec3 dcol, out vec3 thin, out float b) {
  vec3 d = rayDir(p);
  vec3 ddx = rayDir(p + vec2(pixStep.x, 0.0)) - d;
  vec3 ddy = rayDir(p + vec2(0.0, pixStep.y)) - d;
  Hit h0, h1, h2; int nh; bool escaped; vec3 Dsky, Jx, Jy, Jr;
  trace(d, ddx, ddy, wipe, h0, h1, h2, nh, escaped, Dsky, Jx, Jy, Jr, b);
  Lens L;
  L.dx = Jx; L.dy = Jy;
  // how the sky seen through this pixel moves while the shutter is open: the camera circling the
  // hole (the lens map turns with it), the camera turning relative to that (a rigid shift of the
  // image, carried by the pixel Jacobian), and its change of distance (the r0-derivative)
  vec3 dv = cross(uViewRot, d);
  float b11 = dot(ddx, ddx), b12 = dot(ddx, ddy), b22 = dot(ddy, ddy);
  vec2 ab = vec2(b22 * dot(ddx, dv) - b12 * dot(ddy, dv), b11 * dot(ddy, dv) - b12 * dot(ddx, dv)) / max(b11 * b22 - b12 * b12, 1e-24);
  L.dD = cross(uOmega, Dsky) + Jx * ab.x + Jy * ab.y + Jr * uDr;
  L.area = max(length(cross(Jx, Jy)), pixAng * pixAng / 24.0);    // cap the magnification (finite stellar size, and no popping near caustics)
  L.ok = 1.0;
  L.scale = pixStep.y / (2.0 / uRes.y);
  return shade(h0, h1, h2, nh, escaped, Dsky, L, gsky, dcol, thin);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y);
  float px = 2.0 / uRes.y;
  float wipe = uWipe.z > 0.5 ? smoothstep(uWipe.x - uWipe.y, uWipe.x + uWipe.y, gl_FragCoord.x / uRes.x) : uWipe.w;
  float pixAng = 2.0 * uTanHalfFov / uRes.y;
  float gsky = inversesqrt(1.0 - 2.0 / length(uCamPos));   // starlight blueshift for the static camera

  vec3 dcol, thin; float b;
  vec3 col = sample1(p, vec2(px), wipe, gsky, pixAng, dcol, thin, b);

  // adaptive supersampling of the photon ring: rays whose impact parameter is within
  // 10 % of the critical value sqrt(27) M form the exponentially thin higher-order images
  float bc = 5.196152;
  if (b > 0.985 * bc && b < 1.10 * bc) {
    const int NS = 8;
    vec2 offs[NS] = vec2[NS](vec2(-0.4375, -0.0625), vec2(-0.3125, 0.3125), vec2(-0.1875, -0.3125), vec2(-0.0625, 0.1875),
                             vec2(0.0625, -0.4375), vec2(0.1875, 0.4375), vec2(0.3125, -0.1875), vec2(0.4375, 0.0625));
    for (int k = 0; k < NS; k++) {
      vec3 dsub, tsub; float bs;
      col += sample1(p + offs[k] * px, vec2(px) * 0.35, wipe, gsky, pixAng * 0.35, dsub, tsub, bs);
      dcol += dsub;
      thin += tsub;
    }
    col /= float(NS + 1);
    dcol /= float(NS + 1);
    thin /= float(NS + 1);
  }

  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  if (any(isnan(dcol)) || any(isinf(dcol))) dcol = vec3(0.0);
  fragColor = vec4(max(col, vec3(0.0)), 1.0);
  if (any(isnan(thin)) || any(isinf(thin))) thin = vec3(0.0);
  fragDisk = vec4(max(dcol, vec3(0.0)), 1.0);
  fragThin = vec4(max(thin, vec3(0.0)), 1.0);
}
`;

export const fullscreenVert = /* glsl */ `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = P[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;
