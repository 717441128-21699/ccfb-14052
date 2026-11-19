import type { Vec2 } from './types';

export const TAU = Math.PI * 2;
/** 0.1 度对应的弧度，定理校验容差 */
export const ANGLE_EPS = (0.1 * Math.PI) / 180;
/** 坐标重合容差（纸面单位） */
export const COORD_EPS = 1e-9;

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 归一化，零向量返回零向量 */
export function normalize(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  if (len < COORD_EPS) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

/** 极角，范围 [0, 2π) */
export function angleOf(v: Vec2): number {
  const a = Math.atan2(v.y, v.x);
  return a < 0 ? a + TAU : a;
}

/** 把角度吸附到步长（弧度）上 */
export function snapAngle(rad: number, step: number): number {
  return Math.round(rad / step) * step;
}

/** 把坐标吸附到网格 */
export function snapToGrid(p: Vec2, spacing: number): Vec2 {
  return {
    x: Math.round(p.x / spacing) * spacing,
    y: Math.round(p.y / spacing) * spacing,
  };
}

/**
 * 点 p 是否落在线段 a-b 上（含端点），距离容差 tol。
 * 用叉积判共线 + 投影范围。
 */
export function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, tol: number): boolean {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const lenSq = dot(ab, ab);
  if (lenSq < COORD_EPS) return dist(p, a) <= tol;
  const t = dot(ap, ab) / lenSq;
  if (t < -COORD_EPS || t > 1 + COORD_EPS) return false;
  const proj = add(a, scale(ab, Math.min(1, Math.max(0, t))));
  return dist(p, proj) <= tol;
}

/** 线段相交测试；共线重叠也算相交 */
export function segmentsIntersect(
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  p4: Vec2,
): boolean {
  const d1 = cross(sub(p3, p1), sub(p2, p1));
  const d2 = cross(sub(p4, p1), sub(p2, p1));
  const d3 = cross(sub(p1, p3), sub(p4, p3));
  const d4 = cross(sub(p2, p3), sub(p4, p3));
  if (((d1 > COORD_EPS && d2 < -COORD_EPS) || (d1 < -COORD_EPS && d2 > COORD_EPS)) &&
      ((d3 > COORD_EPS && d4 < -COORD_EPS) || (d3 < -COORD_EPS && d4 > COORD_EPS))) {
    return true;
  }
  // 共线重叠
  if (Math.abs(d1) <= COORD_EPS && pointOnSegment(p3, p1, p2, COORD_EPS)) return true;
  if (Math.abs(d2) <= COORD_EPS && pointOnSegment(p4, p1, p2, COORD_EPS)) return true;
  if (Math.abs(d3) <= COORD_EPS && pointOnSegment(p1, p3, p4, COORD_EPS)) return true;
  if (Math.abs(d4) <= COORD_EPS && pointOnSegment(p2, p3, p4, COORD_EPS)) return true;
  return false;
}

/** 有符号三角形面积的两倍 */
export function signedArea2(a: Vec2, b: Vec2, c: Vec2): number {
  return cross(sub(b, a), sub(c, a));
}

/** 多边形面积（CCW 为正） */
export function polygonArea(points: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += cross(a, b);
  }
  return s / 2;
}

/** 角度归一化到 [0, 2π) */
export function normAngle(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** 两角度之差归一化到 (-π, π] */
export function angleDelta(a: number, b: number): number {
  let d = normAngle(b - a);
  if (d > Math.PI) d -= TAU;
  return d;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
