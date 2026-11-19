import { angleOf, polygonArea, signedArea2 } from './geometry';
import type { Crease, CreasePattern, Face, PlanarGraph, Vec2 } from './types';
import { edgeKey } from './types';

interface AdjEntry {
  to: number;
  type: Crease['type'];
  angle: number;
}

/**
 * 用半边遍历从折痕线段切分出平面面。
 * 每个有向半边 (u→v) 的下一条半边取 v 处出边中、
 * 相对于反向边 (v→u) 顺时针相邻的一条，使有界面按逆时针绕行。
 */
export function buildPlanarGraph(cp: CreasePattern): PlanarGraph {
  const n = cp.vertices.length;
  const adj: AdjEntry[][] = Array.from({ length: n }, () => []);
  const edgeType = new Map<string, Crease['type']>();

  for (const c of cp.creases) {
    if (c.a === c.b) continue;
    const key = edgeKey(c.a, c.b);
    // 重复边只保留第一条
    if (edgeType.has(key)) continue;
    edgeType.set(key, c.type);
    adj[c.a].push({ to: c.b, type: c.type, angle: angleOf(sub2(cp.vertices, c.b, c.a)) });
    adj[c.b].push({ to: c.a, type: c.type, angle: angleOf(sub2(cp.vertices, c.a, c.b)) });
  }

  // 每个顶点的出边按极角逆时针排序
  for (const list of adj) {
    list.sort((p, q) => p.angle - q.angle);
  }

  // nextHalf(u,v)：v 处出边中相对 (v,u) 顺时针的下一条
  const nextHalf = new Map<string, string>();
  for (let v = 0; v < n; v++) {
    const list = adj[v];
    for (let i = 0; i < list.length; i++) {
      const reverseNeighbor = list[i].to;
      const prev = list[(i - 1 + list.length) % list.length];
      nextHalf.set(halfKey(reverseNeighbor, v), halfKey(v, prev.to));
    }
  }

  const faces: Face[] = [];
  const edgeFaces = new Map<string, [number, number]>();
  const visited = new Set<string>();

  for (const c of cp.creases) {
    const start = halfKey(c.a, c.b);
    if (visited.has(start)) continue;
    const cycle: number[] = [];
    let cur = start;
    let guard = 0;
    const maxSteps = cp.creases.length * 2 + 2;
    while (!visited.has(cur) && guard++ <= maxSteps) {
      visited.add(cur);
      const [u] = parseHalf(cur);
      cycle.push(u);
      const nxt = nextHalf.get(cur);
      if (nxt === undefined) break;
      cur = nxt;
    }
    if (cycle.length < 3) {
      // 悬空边产生的退化环，标记为外侧
      for (const id of cycleHalfEdges(cycle)) visited.add(id);
      continue;
    }
    const pts = cycle.map((id) => cp.vertices[id]);
    const area = polygonArea(pts);
    if (area <= 0) {
      // 顺时针 = 无界面（纸张外）
      continue;
    }
    const faceId = faces.length;
    faces.push({ vertices: cycle });
    for (let i = 0; i < cycle.length; i++) {
      const u = cycle[i];
      const v = cycle[(i + 1) % cycle.length];
      const key = edgeKey(u, v);
      const prev = edgeFaces.get(key);
      if (prev === undefined) {
        edgeFaces.set(key, [faceId, -1]);
      } else {
        edgeFaces.set(key, [prev[0], faceId]);
      }
    }
  }

  const faceNeighbors = new Map<number, number[]>();
  faces.forEach((_, id) => faceNeighbors.set(id, []));
  for (const [key, [f1, f2]] of edgeFaces) {
    if (f2 < 0) continue;
    faceNeighbors.get(f1)!.push(f2);
    faceNeighbors.get(f2)!.push(f1);
    void key;
  }

  return { cp, faces, edgeFaces, faceNeighbors };
}

/** 边的折痕类型，查不到（理论上不会）按边界处理 */
export function typeOfEdge(graph: PlanarGraph, a: number, b: number): Crease['type'] {
  const t = graph.cp.creases.find(
    (c) => (c.a === a && c.b === b) || (c.a === b && c.b === a),
  )?.type;
  return t ?? 'border';
}

/** 面质心 */
export function faceCentroid(graph: PlanarGraph, faceId: number): Vec2 {
  const f = graph.faces[faceId];
  let x = 0;
  let y = 0;
  for (const vid of f.vertices) {
    x += graph.cp.vertices[vid].x;
    y += graph.cp.vertices[vid].y;
  }
  return { x: x / f.vertices.length, y: y / f.vertices.length };
}

/** 判断点在哪个面内（射线法），返回 -1 表示在纸外 */
export function findFaceAt(graph: PlanarGraph, p: Vec2): number {
  for (let id = 0; id < graph.faces.length; id++) {
    if (pointInFace(graph, id, p)) return id;
  }
  return -1;
}

export function pointInFace(graph: PlanarGraph, faceId: number, p: Vec2): boolean {
  const verts = graph.faces[faceId].vertices;
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = graph.cp.vertices[verts[i]];
    const b = graph.cp.vertices[verts[j]];
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** 面是否为凸多边形 */
export function isConvex(graph: PlanarGraph, faceId: number): boolean {
  const verts = graph.faces[faceId].vertices;
  if (verts.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = graph.cp.vertices[verts[i]];
    const b = graph.cp.vertices[verts[(i + 1) % verts.length]];
    const c = graph.cp.vertices[verts[(i + 2) % verts.length]];
    const s = signedArea2(a, b, c);
    if (Math.abs(s) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(s);
    else if (Math.sign(s) !== sign) return false;
  }
  return true;
}

function sub2(verts: Vec2[], a: number, b: number): Vec2 {
  return { x: verts[a].x - verts[b].x, y: verts[a].y - verts[b].y };
}

function halfKey(u: number, v: number): string {
  return `${u}>${v}`;
}

function parseHalf(key: string): [number, number] {
  const i = key.indexOf('>');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

function cycleHalfEdges(cycle: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < cycle.length; i++) {
    out.push(halfKey(cycle[i], cycle[(i + 1) % cycle.length]));
  }
  return out;
}
