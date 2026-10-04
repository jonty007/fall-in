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
uniform sampler2D uLut;     // row 0: blackbody, row 1: disk temperature profile

out vec4 fragColor;

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
  for (int i = 0; i < 6; i++) {
    float fade = clamp(1.5 - lod * exp2(float(i)), 0.0, 1.0);  // drop octaves finer than the pixel footprint
    s += a * fade * snoise(p);
    n += a;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.52;
  }
  return s / n;
}

float fbm3(vec3 p, float lod) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 3; i++) {
    float fade = clamp(1.5 - lod * exp2(float(i)), 0.0, 1.0);
    s += a * fade * snoise(p);
    n += a;
    p = p * 2.07 + vec3(4.1, 2.3, 7.7);
    a *= 0.55;
  }
  return s / n;
}

float diskLayer(float r, float ang, float lr, float age, float seed, float lod) {
  float Om = pow(r, -1.5);
  float a = ang - uSpin * Om * age;
  vec2 cs = vec2(cos(a), sin(a));
  // large clumps and arms (roughly isotropic; Keplerian shear turns them into spirals)
  vec3 p1 = vec3(cs * 3.4, lr * 3.6 + seed * 7.31);
  float warp = snoise(p1 * 0.8 + vec3(seed));
  float big = fbm3(p1 + vec3(warp * 0.6, -warp * 0.4, warp * 0.3), lod * 0.35);
  // streaks: stretched along the orbit, displaced by the clumps
  float sa = a + 1.2 * lr;   // gentle trailing spiral pitch for the fine structure
  vec2 cs2 = vec2(cos(sa), sin(sa));
  vec3 p2 = vec3(cs2 * 5.0, lr * 9.0 + seed * 3.17 + big * 1.1);
  float streak = fbm(p2, lod);
  // thin bright filaments
  vec3 q = vec3(cs2 * 9.0, lr * 24.0 + seed * 5.3 + big * 2.0);
  float fil = 1.0 - abs(snoise(q));
  float filFade = clamp(1.5 - lod * 4.0, 0.0, 1.0);
  return big * 0.9 + streak * 0.42 + (fil * fil * fil - 0.3) * 0.28 * filFade;
}

// returns rgb emission (already * alpha) and alpha
vec4 diskSample(vec3 P, float r, float cosInc, float g, float lod) {
  float ang = atan(P.z, P.x);
  float lr = log(r);
  const float PERIOD = 420.0;
  float ph = uTime / PERIOD;
  float n = 0.0;
  for (int k = 0; k < 2; k++) {
    float pk = ph + float(k) * 0.5;
    float cyc = floor(pk);
    float fr = pk - cyc;
    float w = 1.0 - abs(2.0 * fr - 1.0);
    n += w * diskLayer(r, ang, lr, fr * PERIOD, cyc * 2.0 + float(k), lod);
  }
  // radial structure: soft outer fade, crisp ISCO edge
  float edgeW = max(0.04, lod * r * 0.6);
  float inner = smoothstep(uRin, uRin + edgeW, r);
  float outer = 1.0 - smoothstep(uRout * 0.55, uRout, r);
  float dens = inner * outer * clamp(0.55 + 1.6 * n, 0.0, 1.8);
  float tau = 1.6 * dens / max(abs(cosInc), 0.08);
  float alpha = 1.0 - exp(-tau);
  float T = uTpeak * diskProfile(r) * (0.9 + 0.22 * clamp(n, -1.0, 1.0)) * g;
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
struct Lens { vec3 dx; vec3 dy; float area; float ok; };

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
  float foot = sqrt(L.area);
  lodW = smoothstep(0.10, 0.32, foot / cellAng) ;
  if (L.ok < 0.5) lodW = 1.0;
  vec3 rnd = rand3(uvec3(uvec2(cell), face * 16u + layer));
  vec3 rnd2 = rand3(uvec3(uvec2(cell) + 7919u, face * 16u + layer + 101u));
  float p = min(prob * (1.0 + 2.2 * gal), 1.0);
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
  vec2 pp = vec2(a22 * rhs.x - a12 * rhs.y, a11 * rhs.y - a12 * rhs.x) / det;
  // brightness: number counts N(<m) ~ 10^(0.6 m)
  m = clamp(mMax + log(max(rnd2.x, 1e-6)) / (0.6 * log(10.0)), mMin, mMax);
  float flux = pow(10.0, -0.4 * m);
  // colour temperature: mostly K/G/F, some A/B
  float t = rnd2.y;
  float T = t < 0.55 ? mix(3600.0, 5600.0, t / 0.55) : (t < 0.88 ? mix(5600.0, 8000.0, (t - 0.55) / 0.33) : mix(8000.0, 22000.0, pow(max((t - 0.88) / 0.12, 0.0), 1.5)));
  vec3 bbBase = blackbody(T);
  vec3 bb = blackbody(T * gsky);
  float lum = dot(bbBase, vec3(0.2126, 0.7152, 0.0722));
  vec3 col = bb / max(lum, 1e-6);           // flux scales with the blueshifted spectrum
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.62);
  float r2 = dot(pp, pp);
  const float SIG = 0.85;
  float core = exp(-0.5 * r2 / (SIG * SIG)) / (2.0 * PI * SIG * SIG);
  float halo = exp(-0.5 * r2 / 9.0) / (2.0 * PI * 9.0) * 0.06 * smoothstep(1.0, -1.0, m);
  float area = max(L.area, 1e-14);
  const float REF_AREA = 4.55e-7;   // solid angle of a 1080p pixel at a 40 degree field of view
  return col * flux * (core + halo) * (REF_AREA / area) * (1.0 - lodW);
}

// mean radiance of a star layer (for cells smaller than the pixel footprint)
float layerMean(float prob, float mMin, float mMax, float N) {
  float Ef = 3.0 * pow(10.0, -0.4 * mMax) - 2.0 * pow(10.0, 0.2 * mMin - 0.6 * mMax);
  float cellAng = (PI * 0.5) / N;
  return prob * Ef * 4.55e-7 / (cellAng * cellAng);
}

vec3 sky(vec3 D, Lens L, float gsky) {
  float foot = sqrt(L.area);
  float lod = L.ok > 0.5 ? foot * 2.0 : 4.0;
  float gal = galaxyDensity(D, lod);
  float gboost = dot(blackbody(5200.0 * gsky), vec3(0.2126, 0.7152, 0.0722)) / dot(blackbody(5200.0), vec3(0.2126, 0.7152, 0.0722));
  vec3 avgCol = vec3(0.93, 0.95, 1.0) * gboost;
  vec3 col = vec3(0.0);
  float lw;
  {
    mat3 R = rotX(0.31) * rotY(0.7);
    col += starLayer(D, L, R, 90.0, 0.55, -1.2, 5.5, 1u, gal * 0.4, gsky, lw);
    col += avgCol * lw * layerMean(min(0.55 * (1.0 + 2.2 * gal * 0.4), 1.0), -1.2, 5.5, 90.0);
  }
  {
    mat3 R = rotX(-0.83) * rotY(2.1);
    col += starLayer(D, L, R, 230.0, 0.75, 3.5, 8.0, 2u, gal, gsky, lw);
    col += avgCol * lw * layerMean(min(0.75 * (1.0 + 2.2 * gal), 1.0), 3.5, 8.0, 230.0);
  }
  {
    mat3 R = rotX(1.37) * rotY(-0.4);
    col += starLayer(D, L, R, 520.0, 0.85, 6.5, 10.5, 3u, gal, gsky, lw);
    col += avgCol * lw * layerMean(min(0.85 * (1.0 + 2.2 * gal), 1.0), 6.5, 10.5, 520.0);
  }
  vec3 galCol = mix(vec3(1.0, 0.86, 0.70), vec3(0.85, 0.9, 1.0), 0.35);
  col *= uStarGain;
  col += galCol * gal * uGalaxyGain * gboost;
  return col;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y);
  vec3 d = normalize(uCamFwd + uTanHalfFov * (p.x * uCamRight + p.y * uCamUp));

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
  vec3  nrm = cross(e1, e2);                  // orbital plane normal (tracing direction)
  float bz = -b * nrm.y * uSpin;              // photon angular momentum along the gas motion

  // phi of disk-plane crossings: cos(phi) e1.y + sin(phi) e2.y = 0
  float A = e1.y, B = e2.y;
  float phi0 = atan(B, A) + 0.5 * PI;
  float nextCross = mod(phi0, PI);
  if (nextCross < 1e-6) nextCross += PI;

  float wipe = uWipe.z > 0.5 ? smoothstep(uWipe.x - uWipe.y, uWipe.x + uWipe.y, gl_FragCoord.x / uRes.x) : uWipe.w;

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float phi = 0.0;
  bool escaped = false, captured = false;
  float phiEsc = 0.0;
  float crossings = 0.0;
  float pixAng = 2.0 * uTanHalfFov / uRes.y;

  for (int i = 0; i < MAX_STEPS; i++) {
    // step size: fine near the photon sphere, coarse far away (the equation is
    // almost harmonic there), and limited so u never changes by more than ~12 % per step
    float hb = mix(0.16, 0.017, smoothstep(0.012, 0.24, u));
    float hrel = 0.12 * u / (abs(w) + 1e-6);
    float hmin = mix(0.16, 0.0015, smoothstep(0.012, 0.05, u));
    float h = min(hb, max(hrel, hmin));

    // RK4 on (u, w): u' = w, w' = 3u^2 - u
    float k1u = w,              k1w = 3.0 * u * u - u;
    float u2 = u + 0.5 * h * k1u;
    float k2u = w + 0.5 * h * k1w, k2w = 3.0 * u2 * u2 - u2;
    float u3 = u + 0.5 * h * k2u;
    float k3u = w + 0.5 * h * k2w, k3w = 3.0 * u3 * u3 - u3;
    float u4 = u + h * k3u;
    float k4u = w + h * k3w,    k4w = 3.0 * u4 * u4 - u4;
    float un = u + h / 6.0 * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    float wn = w + h / 6.0 * (k1w + 2.0 * k2w + 2.0 * k3w + k4w);

    // escape inside this step? find u = 0 on the Hermite cubic
    float sEsc = 2.0;
    if (un <= 0.0) {
      float s = u / (u - un);
      for (int it = 0; it < 4; it++) {
        float s2 = s * s, s3 = s2 * s;
        float H = (2.0*s3 - 3.0*s2 + 1.0) * u + (s3 - 2.0*s2 + s) * w * h + (-2.0*s3 + 3.0*s2) * un + (s3 - s2) * wn * h;
        float dH = (6.0*s2 - 6.0*s) * u + (3.0*s2 - 4.0*s + 1.0) * w * h + (-6.0*s2 + 6.0*s) * un + (3.0*s2 - 2.0*s) * wn * h;
        if (abs(dH) > 1e-12) s = clamp(s - H / dH, 0.0, 1.0);
      }
      sEsc = s;
    }

    // disk-plane crossing inside this step
    if (nextCross <= phi + h) {
      float s = (nextCross - phi) / h;
      if (s < sEsc) {
        float s2 = s * s, s3 = s2 * s;
        float uc = (2.0*s3 - 3.0*s2 + 1.0) * u + (s3 - 2.0*s2 + s) * w * h + (-2.0*s3 + 3.0*s2) * un + (s3 - s2) * wn * h;
        float wc = ((6.0*s2 - 6.0*s) * u + (3.0*s2 - 4.0*s + 1.0) * w * h + (-6.0*s2 + 6.0*s) * un + (3.0*s2 - 2.0*s) * wn * h) / h;
        float rc = 1.0 / max(uc, 1e-6);
        if (rc > uRin - 0.5 && rc < uRout && uc > 0.0) {
          float cp = cos(nextCross), sp = sin(nextCross);
          vec3 P = (cp * e1 + sp * e2) * rc;
          // local photon direction (static frame) to get the incidence angle on the disk
          vec3 radial = cp * e1 + sp * e2;
          vec3 tang = -sp * e1 + cp * e2;
          float drdphi = -wc * rc * rc;
          float fc = 1.0 - 2.0 / rc;
          vec3 kloc = normalize(radial * drdphi / sqrt(max(fc, 1e-4)) + tang * rc);
          float cosInc = kloc.y;
          // redshift: gas on Keplerian circular orbits, static camera at r0
          float ut = inversesqrt(max(1.0 - 3.0 / rc, 1e-4));
          float Om = pow(rc, -1.5);
          float gD = 1.0 / (sf0 * ut * (1.0 - Om * bz));
          float gNo = 1.0;                                  // no frequency shifts at all, as rendered for Interstellar (James et al. 2015, fig. 15a)
          float g = mix(gNo, gD, wipe);
          float dist = (crossings < 0.5) ? length(P - uCamPos) : (length(P - uCamPos) * (2.0 + 4.0 * crossings));
          float lod = dist * pixAng / max(abs(cosInc), 0.15) / rc;   // footprint relative to radius
          vec4 ds = diskSample(P, rc, cosInc, g, lod * 9.0);
          col += trans * ds.rgb;
          trans *= 1.0 - ds.a;
          crossings += 1.0;
        }
      }
      nextCross += PI;
    }

    if (sEsc <= 1.0) { escaped = true; phiEsc = phi + sEsc * h; break; }
    if (un > 0.338) { captured = true; break; }   // inside the photon sphere moving in: falls in
    if (trans < 0.003) break;
    phi += h; u = un; w = wn;
  }

  vec3 Dsky = escaped ? (cos(phiEsc) * e1 + sin(phiEsc) * e2) : d;
  float esc = escaped ? 1.0 : 0.0;
  Lens L;
  L.dx = dFdx(Dsky);
  L.dy = dFdy(Dsky);
  L.area = length(cross(L.dx, L.dy));
  L.ok = (abs(dFdx(esc)) + abs(dFdy(esc)) < 0.5) ? 1.0 : 0.0;
  // cap the magnification (finite stellar size)
  L.area = max(L.area, pixAng * pixAng / 400.0);

  if (escaped && trans > 0.003) {
    col += trans * sky(Dsky, L, 1.0 / sf0);
  }
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  fragColor = vec4(max(col, vec3(0.0)), 1.0);
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
