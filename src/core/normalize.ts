import {
  COORD_EPS,
  cross,
  dist,
  pointOnSegment,
  sub,
} from './geometry';
import type { Crease, CreasePattern, Vec2 } from './types';

/**
 * 规范化折痕图：
 * 1. 合并 tol 范围内的重合顶点；
 * 2. 在两条线段的内部交点、T 形接点处插入顶点并分裂线段，
 *    分裂出的子段继承原折痕类型。
 * 返回全新对象，不修改入参。
 */
export function normalizeCreasePattern(
  cp: CreasePattern,
  tol = 1e-6,
): CreasePattern {
  // ---- 1. 合并重合顶点 ----
  const verts: Vec2[] = [];
  const remap = new Map<string, number>();
  const gridSize = Math.max(tol, 1e-9);

  const canonical = (p: Vec2): number => {
    const gx = Math.round(p.x / gridSize);
    const gy = Math.round(p.y / gridSize);
    const key = `${gx}|${gy}`;
    const known = remap.get(key);
    if (known !== undefined) {
      // 网格桶内再做一次真实距离检查
      if (dist(verts[known], p) <= tol * 4) return known;
    }
    const id = verts.length;
    verts.push({ ...p });
    remap.set(key, id);
    return id;
  };

  let work: Crease[] = cp.creases.map((c) => ({
    ...c,
    a: canonical(cp.vertices[c.a]),
    b: canonical(cp.vertices[c.b]),
  }));

  // ---- 2. 分裂交叉与 T 接 ----
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    outer: for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const e1 = work[i];
        const e2 = work[j];
        const p1 = verts[e1.a];
        const p2 = verts[e1.b];
        const p3 = verts[e2.a];
        const p4 = verts[e2.b];

        const hit = segmentIntersection(p1, p2, p3, p4, tol);
        if (hit === null) continue;
        if (dist(hit, p1) <= tol || dist(hit, p2) <= tol ||
            dist(hit, p3) <= tol || dist(hit, p4) <= tol) {
          // 交点是已有端点：只处理 T 接（端点落在另一线段内部）
          const split = tryTSplit(verts, work, i, j, tol);
          if (split) {
            changed = true;
            break outer;
          }
          continue;
        }
        // 内部交点：两条线段都分裂
        const q = verts.length;
        verts.push(hit);
        const a1 = e1.a;
        const b1 = e1.b;
        const a2 = e2.a;
        const b2 = e2.b;
        work[i] = { a: a1, b: q, type: e1.type };
        work[j] = { a: a2, b: q, type: e2.type };
        work.push({ a: q, b: b1, type: e1.type });
        work.push({ a: q, b: b2, type: e2.type });
        changed = true;
        break outer;
      }
    }
  }

  // 清理零长段与重复段。同一对顶点若有多条不同类型的边（共线重叠），
  // 内部折痕（山/谷）优先于 border，避免折痕被边界类型吞掉。
  const byEdge = new Map<string, Crease>();
  for (const c of work) {
    if (c.a === c.b) continue;
    const key = c.a < c.b ? `${c.a}_${c.b}` : `${c.b}_${c.a}`;
    const prev = byEdge.get(key);
    if (prev === undefined) {
      byEdge.set(key, c);
    } else if (prev.type === 'border' && c.type !== 'border') {
      byEdge.set(key, c);
    }
  }
  const out: Crease[] = [...byEdge.values()];

  // 去掉孤立顶点，重新编号
  const used = new Set<number>();
  out.forEach((c) => {
    used.add(c.a);
    used.add(c.b);
  });
  const compact: Vec2[] = [];
  const idMap = new Map<number, number>();
  for (const id of used) {
    idMap.set(id, compact.length);
    compact.push(verts[id]);
  }
  return {
    vertices: compact,
    creases: out.map((c) => ({
      a: idMap.get(c.a)!,
      b: idMap.get(c.b)!,
      type: c.type,
    })),
  };
}

function tryTSplit(
  verts: Vec2[],
  work: Crease[],
  i: number,
  j: number,
  tol: number,
): boolean {
  let did = false;
  did = splitIfEndpointInside(verts, work, i, j, tol) || did;
  did = splitIfEndpointInside(verts, work, j, i, tol) || did;
  return did;
}

/** 若 ej 的某个端点落在 ei 内部，则在该点分裂 ei */
function splitIfEndpointInside(
  verts: Vec2[],
  work: Crease[],
  ei: number,
  ej: number,
  tol: number,
): boolean {
  const e = work[ei];
  const other = work[ej];
  const a = verts[e.a];
  const b = verts[e.b];
  for (const endpointId of [other.a, other.b]) {
    const p = verts[endpointId];
    if (endpointId === e.a || endpointId === e.b) continue;
    if (pointOnSegment(p, a, b, tol)) {
      const oldB = e.b;
      work[ei] = { a: e.a, b: endpointId, type: e.type };
      work.push({ a: endpointId, b: oldB, type: e.type });
      return true;
    }
  }
  return false;
}

/** 求两线段交点；不相交返回 null（共线重叠也返回 null，由 T 接逻辑兜底） */
function segmentIntersection(
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  p4: Vec2,
  tol: number,
): Vec2 | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const denom = cross(r, s);
  const qp = sub(p3, p1);
  if (Math.abs(denom) <= COORD_EPS) {
    // 平行或共线
    if (Math.abs(cross(qp, r)) > tol) return null;
    return null;
  }
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  return { x: p1.x + t * r.x, y: p1.y + t * r.y };
}
