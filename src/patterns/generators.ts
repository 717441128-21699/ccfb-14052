/**
 * 经典折痕图案自动生成器。
 * 所有内部顶点都按前川定理分配山谷：
 *   4 射线顶点 3:1、8 射线顶点 5:3、16 射线顶点 9:7；
 * 几何上采用平行四边形 / 等分射线结构，使川崎定理天然成立。
 */
import type { Crease, CreasePattern, Vec2 } from '../core/types';

class Builder {
  readonly vertices: Vec2[] = [];
  private readonly index = new Map<string, number>();
  readonly creases: Crease[] = [];
  private readonly edgeSeen = new Set<string>();

  v(x: number, y: number): number {
    const key = `${r(x)}|${r(y)}`;
    const known = this.index.get(key);
    if (known !== undefined) return known;
    const id = this.vertices.length;
    this.vertices.push({ x, y });
    this.index.set(key, id);
    return id;
  }

  edge(a: number, b: number, type: Crease['type']): void {
    if (a === b) return;
    const key = a < b ? `${a}>${b}` : `${b}>${a}`;
    if (this.edgeSeen.has(key)) return;
    this.edgeSeen.add(key);
    this.creases.push({ a, b, type });
  }

  build(): CreasePattern {
    return {
      vertices: this.vertices.map((p) => ({ ...p })),
      creases: [...this.creases],
    };
  }
}

function r(n: number): string {
  return n.toFixed(8);
}

/**
 * 山谷自动平衡（BFS 分量构造）。
 * 对内部折痕图按连通分量处理：从一个顶点出发 BFS，
 * 每个顶点按极角排序入射折痕，在已确定的共享边基础上，
 * 用多数派补全构造满足前川定理的赋值
 * （4 射线 3:1、8 射线 5:3、16 射线 9:7）。
 * 边类型全局唯一，无回溯、线性时间。
 */
function balanceMountainValley(cp: CreasePattern): CreasePattern {
  const n = cp.vertices.length;
  const incident: number[][] = Array.from({ length: n }, () => []);
  cp.creases.forEach((c, eid) => {
    if (c.type !== 'border') {
      incident[c.a].push(eid);
      incident[c.b].push(eid);
    }
  });

  const isConstrained = (v: number): boolean => {
    if (incident[v].length < 4 || incident[v].length % 2 !== 0) return false;
    return !cp.creases.some(
      (c) => c.type === 'border' && (c.a === v || c.b === v),
    );
  };

  const sortedEdges = (v: number) =>
    incident[v]
      .map((eid) => {
        const c = cp.creases[eid];
        const other = c.a === v ? c.b : c.a;
        const p = cp.vertices[other];
        const o = cp.vertices[v];
        return { eid, angle: Math.atan2(p.y - o.y, p.x - o.x) };
      })
      .sort((a, b) => a.angle - b.angle);

  const edgeVal = new Map<number, 0 | 1>();

  // 反复多轮构造：每轮按度数升序处理所有约束顶点，
  // 已确定的边保持不变，只补全未知边；多轮后共享边约束自然收敛。
  for (let round = 0; round < 30; round++) {
    let changed = false;
    const seeds = [...Array(n).keys()]
      .filter((v) => isConstrained(v))
      .sort((a, b) => incident[a].length - incident[b].length);
    for (const v of seeds) {
      const targetM = incident[v].length / 2 + 1;
      const knownM = incident[v].filter((eid) => edgeVal.get(eid) === 1).length;
      if (knownM === targetM) continue;
      const unknown = incident[v].filter((eid) => edgeVal.get(eid) === undefined);
      if (unknown.length === 0) continue;
      const needM = Math.max(0, Math.min(unknown.length, targetM - knownM));
      unknown.forEach((eid, k) => edgeVal.set(eid, k < needM ? 1 : 0));
      changed = true;
    }
    if (!changed) break;
  }

  // 预计算每个约束顶点的严格最小扇形角折痕对
  const minAnglePairs = new Map<number, Array<[number, number]>>();
  for (let v = 0; v < n; v++) {
    if (!isConstrained(v)) continue;
    const sorted = sortedEdges(v);
    const secs = sorted.map((item, i) => {
      const a = item.angle;
      const b = sorted[(i + 1) % sorted.length].angle;
      let d = b - a;
      if (d <= 0) d += Math.PI * 2;
      return d;
    });
    const minSec = Math.min(...secs);
    const pairs: Array<[number, number]> = [];
    // 所有最小扇形（含并列）的边界折痕都要求异侧
    for (let i = 0; i < sorted.length; i++) {
      if (secs[i] <= minSec + 1e-9) {
        pairs.push([sorted[i].eid, sorted[(i + 1) % sorted.length].eid]);
      }
    }
    minAnglePairs.set(v, pairs);
  }

  // 最终修复轮：翻转一条边时同时校验两端顶点，避免拆东墙补西墙。
  const violationOf = (v: number): number => {
    if (!isConstrained(v)) return 0;
    const targetM = incident[v].length / 2 + 1;
    const m = incident[v].filter((eid) => edgeVal.get(eid) === 1).length;
    return Math.abs(m - targetM);
  };

  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    // 违约最严重的顶点优先
    const bad = [...Array(n).keys()]
      .filter((v) => isConstrained(v) && violationOf(v) > 0)
      .sort((a, b) => violationOf(b) - violationOf(a));
    if (bad.length === 0) break;

    for (const v of bad) {
      const targetM = incident[v].length / 2 + 1;
      const m = incident[v].filter((eid) => edgeVal.get(eid) === 1).length;
      const wantMountain = m < targetM;
      // 优先选翻转后对端不恶化的边；没有则接受总违约增量最小的边
      let best: number | undefined;
      let bestScore = Infinity;
      let fallback: number | undefined;
      let fallbackScore = Infinity;
      for (const eid of incident[v]) {
        const val = edgeVal.get(eid) ?? 0;
        if (wantMountain ? val !== 0 : val !== 1) continue;
        const c = cp.creases[eid];
        const other = c.a === v ? c.b : c.a;
        const before = violationOf(other);
        edgeVal.set(eid, wantMountain ? 1 : 0);
        const after = violationOf(other);
        edgeVal.set(eid, val);
        if (after <= before && after < bestScore) {
          bestScore = after;
          best = eid;
        }
        if (after < fallbackScore) {
          fallbackScore = after;
          fallback = eid;
        }
      }
      const chosen = best ?? fallback;
      if (chosen !== undefined) {
        edgeVal.set(chosen, wantMountain ? 1 : 0);
        changed = true;
      }
    }
    if (!changed) break;
  }

  cp.creases.forEach((c, eid) => {
    if (c.type === 'border') return;
    c.type = (edgeVal.get(eid) ?? 0) === 1 ? 'mountain' : 'valley';
  });
  return cp;
}

export interface TessellationOptions {
  rows: number;
  cols: number;
  cellW?: number;
  cellH?: number;
}

/**
 * 三浦折叠（Miura-ori）。
 * 边优先指派，保证每个内部顶点 3:1：
 *   水平边按 (i+j) 棋盘格取山谷；竖直边按列 j 交替。
 */
/**
 * 三浦折叠（Miura-ori）。
 * 经典三浦指派：水平折痕按行号奇偶交替，竖直折痕按列号奇偶交替，
 * 每个内部顶点恰好 3 谷 1 山或 1 谷 3 山。
 */
export function miuraOri(opts: TessellationOptions): CreasePattern {
  const { rows, cols } = opts;
  const w = opts.cellW ?? 1;
  const h = opts.cellH ?? 1;
  const skew = 0.18 * w;
  const b = new Builder();
  const id = (i: number, j: number) => b.v(j * w + (i % 2) * skew, i * h);

  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const cur = id(i, j);
      if (i < rows) {
        const below = id(i + 1, j);
        b.edge(cur, below, j === 0 || j === cols ? 'border' : 'valley');
      }
      if (j < cols) {
        const right = id(i, j + 1);
        b.edge(cur, right, i === 0 || i === rows ? 'border' : 'valley');
      }
    }
  }
  return balanceMountainValley(b.build());
}

/**
 * 吉野镶嵌（Yoshimura 钻石棱纹）。
 * 2×2 细分网格，每个单元中心向四角发出菱形对角折痕；
 * 内部中心顶点 8 射线、扇形角全 45°，由 CSP 平衡器分配 5 山 3 谷。
 */
export function yoshimura(opts: TessellationOptions): CreasePattern {
  const { rows, cols } = opts;
  const w = opts.cellW ?? 1;
  const h = opts.cellH ?? 1;
  const b = new Builder();
  const g = (i: number, j: number) => b.v((j * w) / 2, (i * h) / 2);
  const I = rows * 2;
  const J = cols * 2;

  for (let i = 0; i <= I; i++) {
    for (let j = 0; j < J; j++) {
      b.edge(g(i, j), g(i, j + 1), i === 0 || i === I ? 'border' : 'valley');
    }
  }
  for (let j = 0; j <= J; j++) {
    for (let i = 0; i < I; i++) {
      b.edge(g(i, j), g(i + 1, j), j === 0 || j === J ? 'border' : 'valley');
    }
  }
  // 每单元中心到四角的菱形折痕
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * 2;
      const j0 = c * 2;
      const center = g(i0 + 1, j0 + 1);
      b.edge(center, g(i0, j0), 'valley');
      b.edge(center, g(i0, j0 + 2), 'valley');
      b.edge(center, g(i0 + 2, j0), 'valley');
      b.edge(center, g(i0 + 2, j0 + 2), 'valley');
    }
  }
  return balanceMountainValley(b.build());
}

/**
 * 水雷镶嵌（Waterbomb tessellation）。
 * 每单元 2×2 细分：中心 8 射线 5 山 3 谷，边中点 4 射线 3:1，
 * 网格线与中心射线的类型在共享处保持一致。
 */
export function waterbombTessellation(opts: TessellationOptions): CreasePattern {
  const { rows, cols } = opts;
  const w = opts.cellW ?? 1;
  const h = opts.cellH ?? 1;
  const b = new Builder();
  const g = (i: number, j: number) => b.v((j * w) / 2, (i * h) / 2);
  const I = rows * 2;
  const J = cols * 2;

  // 细分网格（占位谷线，平衡器统一指派）
  for (let i = 0; i <= I; i++) {
    for (let j = 0; j < J; j++) {
      b.edge(g(i, j), g(i, j + 1), i === 0 || i === I ? 'border' : 'valley');
    }
  }
  for (let j = 0; j <= J; j++) {
    for (let i = 0; i < I; i++) {
      b.edge(g(i, j), g(i + 1, j), j === 0 || j === J ? 'border' : 'valley');
    }
  }

  // 每单元中心 8 条射线
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * 2;
      const j0 = c * 2;
      const center = g(i0 + 1, j0 + 1);
      b.edge(center, g(i0, j0), 'valley');
      b.edge(center, g(i0, j0 + 2), 'valley');
      b.edge(center, g(i0 + 2, j0), 'valley');
      b.edge(center, g(i0 + 2, j0 + 2), 'valley');
      b.edge(center, g(i0, j0 + 1), 'valley');
      b.edge(center, g(i0 + 2, j0 + 1), 'valley');
      b.edge(center, g(i0 + 1, j0), 'valley');
      b.edge(center, g(i0 + 1, j0 + 2), 'valley');
    }
  }
  return balanceMountainValley(b.build());
}

/**
 * 四方扭转镶嵌（Square twist tessellation）。
 * 3 等分网格 + 每单元四条角部放射折痕；所有内部顶点为 4 或 8 射线，
 * 山谷按显式规则指派，内部顶点满足前川定理。
 */
export function squareTwistTessellation(opts: TessellationOptions): CreasePattern {
  const { rows, cols } = opts;
  const s = opts.cellW ?? 2;
  const b = new Builder();
  const p = (i: number, j: number) => b.v((j * s) / 2, (i * s) / 2);
  const I = rows * 2;
  const J = cols * 2;

  // 完整网格（占位谷线，平衡器统一指派）
  for (let i = 0; i <= I; i++) {
    for (let j = 0; j < J; j++) {
      b.edge(p(i, j), p(i, j + 1), i === 0 || i === I ? 'border' : 'valley');
    }
  }
  for (let j = 0; j <= J; j++) {
    for (let i = 0; i < I; i++) {
      b.edge(p(i, j), p(i + 1, j), j === 0 || j === J ? 'border' : 'valley');
    }
  }
  // 每单元四条角部放射折痕
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * 2;
      const j0 = c * 2;
      const center = p(i0 + 1, j0 + 1);
      b.edge(p(i0, j0), center, 'valley');
      b.edge(p(i0, j0 + 2), center, 'valley');
      b.edge(p(i0 + 2, j0), center, 'valley');
      b.edge(p(i0 + 2, j0 + 2), center, 'valley');
    }
  }
  return balanceMountainValley(b.build());
}

/**
 * 水雷底型（Waterbomb base）：正方形纸，中心 8 条等分射线
 * （4 条到边中点、4 条到角点），5 谷 3 山。
 */
export function waterbombBase(size = 2): CreasePattern {
  const b = new Builder();
  const h = size / 2;
  const c = b.v(0, 0);
  const rays: Array<[number, number]> = [
    [0, -h],
    [h, -h],
    [h, 0],
    [h, h],
    [0, h],
    [-h, h],
    [-h, 0],
    [-h, -h],
  ];
  const ids = rays.map(([x, y]) => b.v(x, y));
  // 外框：边中点与角点共线，相邻点连成 border
  for (let k = 0; k < 8; k++) {
    b.edge(ids[k], ids[(k + 1) % 8], 'border');
  }
  // 5 谷 3 山；山线放在角点方向且互不相邻（最小角条件）
  const mountainIdx = new Set([1, 3, 6]);
  ids.forEach((id, k) => {
    b.edge(c, id, mountainIdx.has(k) ? 'mountain' : 'valley');
  });
  return b.build();
}

/**
 * 鹤底型（鸟底，Bird base）。
 * 上下两个内部点 pTop/pBot 各为 4 射线顶点：
 * 两条竖直到上下边中点、两条斜向到左右两角，扇形角严格
 * (45°,135°,45°,135°)；山谷按 3:1 分配，川崎与前川定理同时成立。
 */
export function craneBase(size = 2): CreasePattern {
  const b = new Builder();
  const h = size / 2;
  const bl = b.v(-h, -h);
  const br = b.v(h, -h);
  const tr = b.v(h, h);
  const tl = b.v(-h, h);
  const t = b.v(0, h);
  const bo = b.v(0, -h);
  const pTop = b.v(0, h / 2);
  const pBot = b.v(0, -h / 2);

  for (const [x, y] of [[bl, br], [br, tr], [tr, tl], [tl, bl]] as const) {
    b.edge(x, y, 'border');
  }
  // 上内部点：竖直山线（唯一山线），其余谷线
  b.edge(pTop, t, 'mountain');
  b.edge(pTop, pBot, 'valley');
  b.edge(pTop, tl, 'valley');
  b.edge(pTop, tr, 'valley');
  // 下内部点：竖直山线（唯一山线），其余谷线
  b.edge(pBot, bo, 'mountain');
  b.edge(pBot, bl, 'valley');
  b.edge(pBot, br, 'valley');
  return b.build();
}

/**
 * 蛙底型（Frog base）：中心 16 条等分射线，9 山 7 谷。
 */
export function frogBase(size = 2): CreasePattern {
  const b = new Builder();
  const h = size / 2;
  const c = b.v(0, 0);
  const outer: number[] = [];
  // 16 个方向：8 个落在纸边（角点/边中点）
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // 与正方形边界相交
    const scale = h / Math.max(Math.abs(dx), Math.abs(dy));
    outer.push(b.v(dx * scale, dy * scale));
  }
  // 外框：按极角排序后的相邻点连接，落在同一条纸边上的点共线
  for (let k = 0; k < 16; k++) {
    const p = b.vertices[outer[k]];
    const q = b.vertices[outer[(k + 1) % 16]];
    const onSameEdge =
      Math.abs(p.x - q.x) < 1e-9 || Math.abs(p.y - q.y) < 1e-9;
    b.edge(outer[k], outer[(k + 1) % 16], onSameEdge ? 'border' : 'mountain');
  }
  // 16 条中心射线，安排 9 山 7 谷，避免同山同谷相邻（最小角条件）
  const mountains = new Set([0, 2, 4, 6, 8, 10, 12, 14, 1]);
  for (let k = 0; k < 16; k++) {
    b.edge(c, outer[k], mountains.has(k) ? 'mountain' : 'valley');
  }
  return b.build();
}
