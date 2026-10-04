// Post-processing: bloom on the hottest regions only, an optional
// "telescope resolution" blur for the payoff, then exposure, AgX tone mapping,
// a single consistent grade, vignette and grain/dither.

const header = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
`;

// 2x downsample with Jimenez's 13-tap filter; optional soft threshold on the first pass
export const downFrag = header + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;
uniform float uThreshold;   // < 0: no threshold
uniform float uKnee;
uniform float uScale;       // exposure applied on the first pass
vec3 tap(vec2 o) { return texture(uSrc, vUv + o * uSrcTexel).rgb; }
void main() {
  vec3 a = tap(vec2(-2, 2)), b = tap(vec2(0, 2)), c = tap(vec2(2, 2));
  vec3 d = tap(vec2(-2, 0)), e = tap(vec2(0, 0)), f = tap(vec2(2, 0));
  vec3 g = tap(vec2(-2, -2)), h = tap(vec2(0, -2)), i = tap(vec2(2, -2));
  vec3 j = tap(vec2(-1, 1)), k = tap(vec2(1, 1)), l = tap(vec2(-1, -1)), m = tap(vec2(1, -1));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  col *= uScale;
  if (uThreshold >= 0.0) {
    float lum = max(col.r, max(col.g, col.b));
    float soft = clamp(lum - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-5);
    float w = max(soft, lum - uThreshold) / max(lum, 1e-5);
    col *= w;
  }
  fragColor = vec4(col, 1.0);
}
`;

// 3x3 tent upsample, added onto the next finer level
export const upFrag = header + /* glsl */ `
uniform sampler2D uSrc;     // coarser level
uniform sampler2D uBase;    // same-size finer level
uniform vec2 uSrcTexel;
uniform float uRadius;
void main() {
  vec2 o = uSrcTexel * uRadius;
  vec3 s = texture(uSrc, vUv).rgb * 4.0;
  s += (texture(uSrc, vUv + vec2(-o.x, 0)).rgb + texture(uSrc, vUv + vec2(o.x, 0)).rgb +
        texture(uSrc, vUv + vec2(0, -o.y)).rgb + texture(uSrc, vUv + vec2(0, o.y)).rgb) * 2.0;
  s += texture(uSrc, vUv + vec2(-o.x, -o.y)).rgb + texture(uSrc, vUv + vec2(o.x, -o.y)).rgb +
       texture(uSrc, vUv + vec2(-o.x, o.y)).rgb + texture(uSrc, vUv + vec2(o.x, o.y)).rgb;
  fragColor = vec4(s / 16.0 + texture(uBase, vUv).rgb, 1.0);
}
`;

// separable Gaussian (telescope blur)
export const blurFrag = header + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDir;          // texel step * direction
uniform float uSigma;       // in texels
void main() {
  vec3 s = vec3(0.0);
  float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    float x = float(i);
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    s += w * texture(uSrc, vUv + uDir * x).rgb;
    wsum += w;
  }
  fragColor = vec4(s / wsum, 1.0);
}
`;

export const compositeFrag = header + /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uTele;
uniform vec2  uRes;
uniform float uExposure;
uniform float uBloomStrength;
uniform vec4  uTeleSplit;    // x: split position (0..1), y: softness, z: amount (0 = off)
uniform float uFade;         // global fade to black (1 = visible)
uniform float uFrame;        // integer frame index for grain
uniform float uGrainPx;      // device pixels per output pixel (grain cell size)
uniform float uVignette;
uniform vec4  uScrim[3];    // soft darkening behind text: rect in uv (x0, y0, x1, y1)
uniform float uScrimK[3];
uniform vec3  uLook;        // x: AgX look power, y: saturation, z: 1 = ACES (Hill fit) instead of AgX

// AgX (Troy Sobotka), polynomial sigmoid fit by Benjamin Wrensch
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 v) {
  const mat3 inset = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                          0.0784335999999992, 0.878468636469772, 0.0784336,
                          0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outset = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                           -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                           -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393, maxEv = 4.026069;
  v = inset * max(v, vec3(1e-10));
  v = clamp(log2(v), minEv, maxEv);
  v = (v - minEv) / (maxEv - minEv);
  v = agxContrast(v);
  // look: gentle punch, keep saturation natural
  float luma = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = pow(max(v, 0.0), vec3(uLook.x));
  luma = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = luma + uLook.y * (v - luma);
  v = outset * v;
  return clamp(v, 0.0, 1.0);
}

vec3 srgbOetf(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 aces(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = inM * (c / 0.6);
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return srgbOetf(outM * (a / b));
}

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(uvec3 p) { return float(pcg(p.x + pcg(p.y + pcg(p.z)))) * (1.0 / 4294967296.0); }

void main() {
  vec3 col = texture(uScene, vUv).rgb * uExposure;
  float tele = 0.0;
  if (uTeleSplit.z > 0.0) {
    tele = smoothstep(uTeleSplit.x - uTeleSplit.y, uTeleSplit.x + uTeleSplit.y, vUv.x) * uTeleSplit.z;
    col = mix(col, texture(uTele, vUv).rgb, tele);
  }
  col += texture(uBloom, vUv).rgb * uBloomStrength * (1.0 - tele);

  // soft scrims behind text blocks (a graded darkening, no edges, no blur of the image)
  for (int i = 0; i < 3; i++) {
    if (uScrimK[i] <= 0.0) continue;
    vec4 R = uScrim[i];
    vec2 c = 0.5 * (R.xy + R.zw), hs = 0.5 * (R.zw - R.xy);
    vec2 dd = (abs(vUv - c) - hs) * vec2(uRes.x / uRes.y, 1.0);
    float dist = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0);
    float m = 1.0 - smoothstep(-0.04, 0.09, dist);
    col *= 1.0 - uScrimK[i] * m;
  }

  // vignette (natural cos^4-like falloff, very gentle)
  vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float vig = 1.0 / pow(1.0 + dot(q, q) * uVignette, 2.0);
  col *= vig;

  vec3 v = (uLook.z > 0.5 ? aces(col) : agx(col));
  // grade: richer ember in the mid-tones, whites left white
  float lumaG = dot(v, vec3(0.2126, 0.7152, 0.0722));
  float satW = smoothstep(0.02, 0.25, lumaG) * (1.0 - smoothstep(0.6, 0.95, lumaG));
  v = clamp(lumaG + (v - lumaG) * (1.0 + 0.28 * satW), 0.0, 1.0);
  // a filmic black: lifted by ~1.5/255 so grain lives in the shadows too
  v = (v * (1.0 - 0.006) + 0.006) * uFade;

  // grain: luminance-weighted, one value per output pixel so it survives the 2x downscale,
  // plus +-1 LSB triangular dither everywhere against banding
  uvec2 cell = uvec2(gl_FragCoord.xy / uGrainPx);
  uint fr = uint(uFrame);
  float n1 = rnd(uvec3(cell, fr * 3u + 1u)), n2 = rnd(uvec3(cell, fr * 3u + 2u));
  float n3 = rnd(uvec3(uvec2(gl_FragCoord.xy), fr * 3u + 7u)), n4 = rnd(uvec3(uvec2(gl_FragCoord.xy) + 911u, fr * 3u + 5u));
  float luma = dot(v, vec3(0.2126, 0.7152, 0.0722));
  float amp = (0.005 + 0.013 * smoothstep(0.02, 0.3, luma) * (1.0 - 0.6 * smoothstep(0.55, 1.0, luma))) * uFade;
  float grain = (n1 + n2 - 1.0) * amp;
  float dither = (n3 + n4 - 1.0) / 255.0;
  v = v + grain * (0.6 + 0.4 * v) + dither;
  fragColor = vec4(v, 1.0);
}
`;

// text/diagram layer: composited last, untouched by grade, grain or blur
export const overlayFrag = header + /* glsl */ `
uniform sampler2D uUi;
void main() {
  fragColor = texture(uUi, vUv);   // premultiplied alpha
}
`;
