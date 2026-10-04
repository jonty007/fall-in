// Camera helpers: spherical placement around the hole and a look-at basis.
// World axes: y is the disk axis, the disk lies in the x-z plane.

export function sph(r, inclDeg, azDeg) {
  const i = (inclDeg * Math.PI) / 180, a = (azDeg * Math.PI) / 180;
  return [r * Math.sin(i) * Math.sin(a), r * Math.cos(i), r * Math.sin(i) * Math.cos(a)];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

// Camera looking from `pos` toward the hole, then turned by yaw/pitch (degrees)
// so the hole can sit off-centre for composition, then rolled.
export function lookBasis(pos, { yaw = 0, pitch = 0, roll = 0, up = [0, 1, 0] } = {}) {
  let f = norm(mul(pos, -1));
  let r = norm(cross(f, up));
  let u = cross(r, f);
  // yaw about camera up, pitch about camera right
  const ya = (yaw * Math.PI) / 180, pa = (pitch * Math.PI) / 180, ra = (roll * Math.PI) / 180;
  const rot = (v, axis, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)));
  };
  f = rot(f, u, ya); r = rot(r, u, ya);
  f = rot(f, r, pa); u = rot(u, r, pa);
  r = rot(r, f, ra); u = rot(u, f, ra);
  return { camPos: pos, camFwd: norm(f), camRight: norm(r), camUp: norm(u) };
}

export const vec = { sub, add, mul, dot, cross, norm };
