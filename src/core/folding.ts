import {
  identity4,
  multiply4,
  rotationAboutAxis4,
  transformPoint4,
  type Mat4,
  type Vec3,
} from './math3d';
import type { PlanarGraph } from './types';
import { edgeKey } from './types';

/**
 * 平折运动学：把二维折痕图沿折痕逐步折到 t=1 的完全平折状态。
 *
 * 做法：以一个面为根保持不动，BFS 沿对偶图（面-折痕-面）传播；
 * 每跨过一条折痕，让新面绕“当前时刻世界坐标中的折痕直线”旋转 t·π，
 * 山谷决定方向。所有折痕同步线性折叠，60 帧即对 t 等分采样。
 */

export interface FoldedFace {
  faceId: number;
  /** 折叠后每个顶点的三维坐标，顺序与 planar face 顶点一致 */
  points: Vec3[];
  /** 该面的世界变换，调试与渲染复用 */
  transform: Mat4;
}

export interface FoldedState {
  t: number;
  faces: FoldedFace[];
}

export const FOLD_FRAME_COUNT = 60;

/** 缓动：前 15% 慢启动，整体平滑，末段收稳 */
export function foldEase(t: number): number {
  const e = t * t * (3 - 2 * t);
  return e;
}

export function foldPattern(graph: PlanarGraph, t: number, rootFaceId = 0): FoldedState {
  const eased = foldEase(t);
  const faceCount = graph.faces.length;
  const transforms: Mat4[] = new Array(faceCount);
  const visited = new Array<boolean>(faceCount).fill(false);

  const root = rootFaceId >= 0 && rootFaceId < faceCount ? rootFaceId : 0;
  transforms[root] = identity4();
  visited[root] = true;

  // 预建面->相邻（面，公共折痕端点）表
  const queue: number[] = [root];
  while (queue.length) {
    const f = queue.shift()!;
    const neighbors = graph.faceNeighbors.get(f) ?? [];
    for (const g of neighbors) {
      if (visited[g]) continue;
      const crease = sharedCrease(graph, f, g);
      if (crease === null) continue;
      const [a, b, creaseType] = crease;

      // 折痕在当前世界坐标中的位置（取面 f 上的两个顶点变换后坐标）
      const pa2 = graph.cp.vertices[a];
      const pb2 = graph.cp.vertices[b];
      const pa: Vec3 = transformPoint4(transforms[f], [pa2.x, pa2.y, 0]);
      const pb: Vec3 = transformPoint4(transforms[f], [pb2.x, pb2.y, 0]);
      const axis: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];

      // 面 g 位于折痕的哪一侧：用质心判断有符号方向
      const sign = sideSign(graph, f, g, a, b);
      // 谷线：相邻面向上（+z）折合；山线：向下（-z）。
      // 旋转方向再乘以 g 所在侧的符号，保证两侧面相向运动。
      const dir = creaseType === 'valley' ? 1 : -1;
      const angle = dir * sign * eased * Math.PI;

      const rot = rotationAboutAxis4(pa, axis, angle);
      transforms[g] = multiply4(rot, transforms[f]);
      visited[g] = true;
      queue.push(g);
    }
  }

  const faces: FoldedFace[] = [];
  for (let fid = 0; fid < faceCount; fid++) {
    if (!visited[fid]) {
      transforms[fid] = identity4();
    }
    const verts = graph.faces[fid].vertices;
    const points = verts.map((vid) => {
      const p = graph.cp.vertices[vid];
      return transformPoint4(transforms[fid], [p.x, p.y, 0]);
    });
    faces.push({ faceId: fid, points, transform: transforms[fid] });
  }

  return { t, faces };
}

/** 生成完整 60 帧（含 t=0 与 t=1） */
export function foldAnimation(graph: PlanarGraph, rootFaceId = 0): FoldedState[] {
  const frames: FoldedState[] = [];
  for (let i = 0; i < FOLD_FRAME_COUNT; i++) {
    const t = i / (FOLD_FRAME_COUNT - 1);
    frames.push(foldPattern(graph, t, rootFaceId));
  }
  return frames;
}

function sharedCrease(
  graph: PlanarGraph,
  f: number,
  g: number,
): [number, number, 'mountain' | 'valley'] | null {
  const fv = new Set(graph.faces[f].vertices);
  for (const v of graph.faces[g].vertices) {
    if (fv.has(v)) {
      // 找公共顶点对
      for (const u of fv) {
        if (u === v) continue;
        const t = graph.cp.creases.find(
          (c) =>
            ((c.a === u && c.b === v) || (c.a === v && c.b === u)) &&
            c.type !== 'border',
        );
        if (t) return [u, v, t.type as 'mountain' | 'valley'];
      }
    }
  }
  void edgeKey;
  return null;
}

/** g 相对有向边 a→b 的侧别（+1 左，-1 右），以面 f 的绕行方向为参照取反 */
function sideSign(graph: PlanarGraph, f: number, g: number, a: number, b: number): number {
  const centroid = (fid: number) => {
    const verts = graph.faces[fid].vertices;
    let x = 0;
    let y = 0;
    for (const vid of verts) {
      x += graph.cp.vertices[vid].x;
      y += graph.cp.vertices[vid].y;
    }
    return { x: x / verts.length, y: y / verts.length };
  };
  const pa = graph.cp.vertices[a];
  const pb = graph.cp.vertices[b];
  const cross = (px: number, py: number) =>
    (pb.x - pa.x) * (py - pa.y) - (pb.y - pa.y) * (px - pa.x);
  const cg = centroid(g);
  const cf = centroid(f);
  const sg = cross(cg.x, cg.y);
  const sf = cross(cf.x, cf.y);
  // 两面必在折痕两侧，符号相反；以 g 的侧别为准
  void sf;
  return sg >= 0 ? 1 : -1;
}
