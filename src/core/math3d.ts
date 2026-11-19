/** 轻量 3D 数学：vec3 与列主序 mat4，仅覆盖折叠动画所需 */

export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function len3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function norm3(a: Vec3): Vec3 {
  const l = len3(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

export function identity4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** 列主序矩阵乘法 out = a * b */
export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = s;
    }
  }
  return out;
}

export function transformPoint4(m: Mat4, p: Vec3): Vec3 {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** 绕过 point 的任意轴旋转 angle（弧度），Rodrigues 公式的 4x4 形式 */
export function rotationAboutAxis4(point: Vec3, axis: Vec3, angle: number): Mat4 {
  const [ux, uy, uz] = norm3(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const [px, py, pz] = point;

  const m = identity4();
  // 旋转部分
  m[0] = t * ux * ux + c;
  m[1] = t * ux * uy + s * uz;
  m[2] = t * ux * uz - s * uy;
  m[4] = t * ux * uy - s * uz;
  m[5] = t * uy * uy + c;
  m[6] = t * uy * uz + s * ux;
  m[8] = t * ux * uz + s * uy;
  m[9] = t * uy * uz - s * ux;
  m[10] = t * uz * uz + c;

  // 平移部分：p - R p
  const rx = m[0] * px + m[4] * py + m[8] * pz;
  const ry = m[1] * px + m[5] * py + m[9] * pz;
  const rz = m[2] * px + m[6] * py + m[10] * pz;
  m[12] = px - rx;
  m[13] = py - ry;
  m[14] = pz - rz;
  return m;
}

/** 透视投影矩阵（OpenGL 风格，NDC z ∈ [-1,1]） */
export function perspective4(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** 简易 lookAt */
export function lookAt4(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const f = norm3(sub3(center, eye));
  const s = norm3(cross3(f, up));
  const u = cross3(s, f);
  const m = identity4();
  m[0] = s[0];
  m[4] = s[1];
  m[8] = s[2];
  m[1] = u[0];
  m[5] = u[1];
  m[9] = u[2];
  m[2] = -f[0];
  m[6] = -f[1];
  m[10] = -f[2];
  m[12] = -dot3(s, eye);
  m[13] = -dot3(u, eye);
  m[14] = dot3(f, eye);
  return m;
}
