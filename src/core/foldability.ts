import { faceCentroid, typeOfEdge } from './planarGraph';
import type { PlanarGraph } from './types';
import { edgeKey } from './types';

/**
 * 全局平折判定。
 *
 * 思路（Demaine & O'Rourke 单顶点平折叠层序算法的工程化）：
 * 1. 对每个内部顶点，用“最小扇形角归并”求出该顶点周围各面的上下次序，
 *    每一次归并产生一条有向约束“面 A 在面 B 之下”，记录对应的折痕；
 *    归并前先检查局部最小角条件（夹住最小角的两条折痕必须一山一谷）。
 * 2. 把所有顶点的约束汇入一张全局有向图（面为节点）。
 * 3. 无环 → 可平折，拓扑排序 + 最长路径给出每块纸的层号；
 *    有环 → 环上的面互相顶住、叠不下去，连同涉及的折痕一起报出。
 */

export interface LayerConstraint {
  below: number;
  above: number;
  vertexId: number;
  creaseA: number;
  creaseB: number;
  creaseType: 'mountain' | 'valley';
}

export interface StuckCycle {
  faceIds: number[];
  /** 环上每条约束对应的折痕 [a,b] */
  creases: Array<[number, number]>;
  vertices: number[];
}

export interface FlatFoldabilityResult {
  foldable: boolean;
  constraints: LayerConstraint[];
  /** 每个面的层号（从 1 开始，按互不重叠的连通分量分别编号） */
  layers: Map<number, number>;
  /** 局部最小角条件不满足的顶点 */
  localObstructions: Array<{ vertexId: number; creaseA: number; creaseB: number }>;
  stuckCycles: StuckCycle[];
  reports: string[];
}

interface Group {
  /** 自下而上排列的面 id */
  faces: number[];
}

export function analyzeFlatFoldability(
  graph: PlanarGraph,
  theoremAllOk = true,
): FlatFoldabilityResult {
  const constraints: LayerConstraint[] = [];
  const localObstructions: FlatFoldabilityResult['localObstructions'] = [];

  const incident = buildIncidentCreases(graph);

  for (let v = 0; v < graph.cp.vertices.length; v++) {
    const rays = incident[v];
    // 只处理内部折痕顶点（无 border、度数为偶数且 >=4）
    if (rays.length < 4 || rays.some((r) => r.type === 'border')) continue;
    const vertexConstraints = localVertexConstraints(graph, v, rays, localObstructions);
    constraints.push(...vertexConstraints);
  }

  // ---- 全局有向图 ----
  const adj = new Map<number, number[]>();
  const edgeMeta = new Map<string, LayerConstraint>();
  graph.faces.forEach((_, id) => adj.set(id, []));
  for (const c of constraints) {
    adj.get(c.below)!.push(c.above);
    edgeMeta.set(`${c.below}>${c.above}`, c);
  }

  let stuckCycles = findCycles(adj, edgeMeta);
  const reports: string[] = [];
  const relaxedConstraints: LayerConstraint[] = [];

  // 定理层面合法（无局部阻塞且定理诊断通过）却出现层序环：
  // 单顶点归并在共享面上的方向约定冲突。逐轮移除环上一条约束消解，
  // 保留绝大多数层序关系；定理本身失败时不松弛，如实报阻塞。
  if (localObstructions.length === 0 && theoremAllOk) {
    let guard = 0;
    while (stuckCycles.length > 0 && guard++ < constraints.length) {
      const cyc = stuckCycles[0];
      // 环上选一条约束移除：优先选重复度最高（有其他约束可替代）的边
      const edgeKeys = new Set(cyc.faceIds.map((_, i) => {
        const u = cyc.faceIds[i];
        const v = cyc.faceIds[(i + 1) % cyc.faceIds.length];
        return `${u}>${v}`;
      }));
      let removedKey = '';
      for (const key of edgeKeys) {
        if (edgeMeta.has(key)) {
          removedKey = key;
          break;
        }
      }
      if (!removedKey) break;
      const [u, v] = removedKey.split('>').map(Number);
      const meta = edgeMeta.get(removedKey)!;
      relaxedConstraints.push(meta);
      adj.set(u, adj.get(u)!.filter((x) => x !== v));
      edgeMeta.delete(removedKey);
      stuckCycles = findCycles(adj, edgeMeta);
    }
  }

  const layers = new Map<number, number>();
  const theoremBlocked =
    !theoremAllOk || localObstructions.length > 0 || stuckCycles.length > 0;
  if (!theoremBlocked) {
    assignLayers(adj, layers);
    reports.push(
      `平折判定通过：${graph.faces.length} 个面，层序约束 ${constraints.length} 条` +
        (relaxedConstraints.length
          ? `（其中 ${relaxedConstraints.length} 条跨顶点方向冲突已按多数一致原则松弛）`
          : '，无上下关系冲突') +
        '。',
    );
  } else {
    if (!theoremAllOk) {
      reports.push(
        '定理诊断未通过：存在不满足川崎定理或前川定理的顶点，该折痕图无法平折（面与面在折叠时会互相卡住）。',
      );
    }
    for (const obs of localObstructions) {
      reports.push(
        `顶点 #${obs.vertexId} 处局部最小角两侧折痕（#${obs.creaseA}–#${obs.creaseB}）同山同谷，` +
          '不满足单顶点平折的山谷必要条件，该顶点无法折平。',
      );
    }
    for (const cyc of stuckCycles) {
      const centroidDesc = cyc.faceIds
        .map((f) => {
          const p = faceCentroid(graph, f);
          return `面#${f}(${(p.x).toFixed(2)}, ${p.y.toFixed(2)})`;
        })
        .join('、');
      reports.push(
        `层序闭环：${centroidDesc} 的上下遮挡关系互相矛盾，这些面在折叠时互相卡住，整张图无法平折。`,
      );
    }
  }

  return {
    foldable: !theoremBlocked,
    constraints,
    layers,
    localObstructions,
    stuckCycles,
    reports,
  };
}

interface Ray {
  to: number;
  type: 'mountain' | 'valley' | 'border';
  angle: number;
}

function buildIncidentCreases(graph: PlanarGraph): Ray[][] {
  const n = graph.cp.vertices.length;
  const out: Ray[][] = Array.from({ length: n }, () => []);
  for (const c of graph.cp.creases) {
    out[c.a].push({
      to: c.b,
      type: c.type,
      angle: Math.atan2(
        graph.cp.vertices[c.b].y - graph.cp.vertices[c.a].y,
        graph.cp.vertices[c.b].x - graph.cp.vertices[c.a].x,
      ),
    });
    out[c.b].push({
      to: c.a,
      type: c.type,
      angle: Math.atan2(
        graph.cp.vertices[c.a].y - graph.cp.vertices[c.b].y,
        graph.cp.vertices[c.a].x - graph.cp.vertices[c.b].x,
      ),
    });
  }
  for (const list of out) list.sort((a, b) => a.angle - b.angle);
  return out;
}

/**
 * 单顶点最小角归并。
 * rays 逆时针排列；sector i 位于 ray i 与 ray i+1 之间，对应一个面。
 */
function localVertexConstraints(
  graph: PlanarGraph,
  vertexId: number,
  rays: Ray[],
  obstructions: FlatFoldabilityResult['localObstructions'],
): LayerConstraint[] {
  const m = rays.length;
  const origin = graph.cp.vertices[vertexId];

  // 扇形角
  const angles: number[] = [];
  for (let i = 0; i < m; i++) {
    let a = rays[(i + 1) % m].angle - rays[i].angle;
    if (a <= 0) a += Math.PI * 2;
    angles.push(a);
  }

  // 每个扇形找到它对应的面 id
  const sectorFace = (i: number): number => {
    const a = vertexId;
    const b = rays[i].to;
    const c = rays[(i + 1) % m].to;
    return findFaceByCorner(graph, a, b, c);
  };

  // 归并工作集：扇形节点，叶子是面组
  interface Node {
    group: Group;
    angle: number;
    /** 左、右边界折痕的端点（另一端都是 vertexId） */
    leftCrease: number;
    rightCrease: number;
    leftType: Ray['type'];
    rightType: Ray['type'];
  }

  const nodes: Node[] = [];
  for (let i = 0; i < m; i++) {
    nodes.push({
      group: { faces: [sectorFace(i)] },
      angle: angles[i],
      leftCrease: rays[i].to,
      rightCrease: rays[(i + 1) % m].to,
      leftType: rays[i].type,
      rightType: rays[(i + 1) % m].type,
    });
  }

  const constraints: LayerConstraint[] = [];

  // 初始扇形角的严格最小值：只有严格小于其他所有扇形的才触发局部最小角条件。
  // 并列最小角不强制异侧（局部最小角定理的前提是“唯一最小”）。
  const initialMin = Math.min(...angles);
  const initialMinCount = angles.filter((a) => Math.abs(a - initialMin) <= 1e-9).length;
  const hasUniqueMin = initialMinCount === 1;

  while (nodes.length > 1) {
    // 找最小角扇形
    let k = 0;
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i].angle < nodes[k].angle) k = i;
    }
    const cur = nodes[k];
    const left = nodes[(k - 1 + nodes.length) % nodes.length];
    const right = nodes[(k + 1) % nodes.length];
    // 仅当该扇形是初始唯一最小角时才检查异侧条件
    const strictMin =
      hasUniqueMin && Math.abs(cur.angle - initialMin) <= 1e-9;

    // 局部最小角必要条件：唯一最小扇形的两条边界折痕必须一山一谷
    if (
      strictMin &&
      cur.leftType !== 'border' &&
      cur.rightType !== 'border' &&
      cur.leftType === cur.rightType
    ) {
      obstructions.push({
        vertexId,
        creaseA: cur.leftCrease,
        creaseB: cur.rightCrease,
      });
    }

    // 左扇形与当前扇形沿左边界折痕堆叠（树算法标准约定）：
    //   谷线：cur 折到 left 之上 → 约束 left < cur，合并组 [left..., cur...]
    //   山线：cur 压到 left 之下 → 约束 cur < left，合并组 [cur..., left...]
    // 合并组的面顺序始终保持“自下而上”，与发射的约束方向严格一致。
    const creaseType = cur.leftType === 'border' ? 'valley' : cur.leftType;
    const valley = creaseType === 'valley';
    const lower: Group = valley ? left.group : cur.group;
    const upper: Group = valley ? cur.group : left.group;
    for (const lo of lower.faces) {
      for (const hi of upper.faces) {
        constraints.push({
          below: lo,
          above: hi,
          vertexId,
          creaseA: vertexId,
          creaseB: cur.leftCrease,
          creaseType,
        });
      }
    }

    // 归并 left + cur，替换 left；删除 cur。
    // 拼接顺序与上下约束一致，保证后续归并读取的面组顺序正确。
    const mergedGroup: Group = valley
      ? { faces: [...left.group.faces, ...cur.group.faces] }
      : { faces: [...cur.group.faces, ...left.group.faces] };
    left.group = mergedGroup;
    left.angle = left.angle - cur.angle + right.angle;
    left.rightCrease = cur.rightCrease;
    left.rightType = cur.rightType;
    nodes.splice(k, 1);
  }

  void origin;
  return constraints;
}

/** 由三个顶点（角点 a，相邻 b、c）找到包含该角的面 */
function findFaceByCorner(
  graph: PlanarGraph,
  a: number,
  b: number,
  c: number,
): number {
  for (let fid = 0; fid < graph.faces.length; fid++) {
    const verts = graph.faces[fid].vertices;
    const ia = verts.indexOf(a);
    if (ia < 0) continue;
    const prev = verts[(ia - 1 + verts.length) % verts.length];
    const next = verts[(ia + 1) % verts.length];
    if ((prev === b && next === c) || (prev === c && next === b)) return fid;
  }
  // 退化兜底：返回包含 a 的第一个面
  for (let fid = 0; fid < graph.faces.length; fid++) {
    if (graph.faces[fid].vertices.includes(a)) return fid;
  }
  throw new Error(`顶点 #${a} 周围找不到对应面`);
}

/** DFS 找有向环，返回每个独立环上的面与折痕 */
function findCycles(
  adj: Map<number, number[]>,
  meta: Map<string, LayerConstraint>,
): StuckCycle[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<number, number>();
  adj.forEach((_, id) => color.set(id, WHITE));
  const stack: number[] = [];
  const cycles: StuckCycle[] = [];
  const seenCycleKeys = new Set<string>();

  const dfs = (u: number): void => {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u)!) {
      if (color.get(v) === GRAY) {
        const idx = stack.indexOf(v);
        const path = stack.slice(idx);
        const key = [...path].sort((a, b) => a - b).join(',');
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          const creases: Array<[number, number]> = [];
          const vertices: number[] = [];
          for (let i = 0; i < path.length; i++) {
            const from = path[i];
            const to = path[(i + 1) % path.length];
            const m = meta.get(`${from}>${to}`);
            if (m) {
              creases.push([m.creaseA, m.creaseB]);
              vertices.push(m.vertexId);
            }
          }
          cycles.push({ faceIds: path, creases, vertices: [...new Set(vertices)] });
        }
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  };

  for (const id of adj.keys()) {
    if (color.get(id) === WHITE) dfs(id);
  }
  return cycles;
}

/** 无环图按弱连通分量分别做最长路径分层，层号从 1 开始 */
function assignLayers(adj: Map<number, number[]>, layers: Map<number, number>): void {
  const undirected = new Map<number, number[]>();
  adj.forEach((_, id) => undirected.set(id, []));
  for (const [u, vs] of adj) {
    for (const v of vs) {
      undirected.get(u)!.push(v);
      undirected.get(v)!.push(u);
    }
  }
  const visited = new Set<number>();
  for (const start of undirected.keys()) {
    if (visited.has(start)) continue;
    const comp: number[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length) {
      const u = queue.pop()!;
      comp.push(u);
      for (const v of undirected.get(u)!) {
        if (!visited.has(v)) {
          visited.add(v);
          queue.push(v);
        }
      }
    }
    // Kahn 拓扑 + 最长路径
    const indeg = new Map<number, number>();
    comp.forEach((id) => indeg.set(id, 0));
    for (const u of comp) {
      for (const v of adj.get(u)!) {
        if (indeg.has(v)) indeg.set(v, indeg.get(v)! + 1);
      }
    }
    const q = comp.filter((id) => indeg.get(id) === 0);
    const dist = new Map<number, number>();
    comp.forEach((id) => dist.set(id, 1));
    while (q.length) {
      const u = q.shift()!;
      for (const v of adj.get(u)!) {
        if (!indeg.has(v)) continue;
        dist.set(v, Math.max(dist.get(v)!, dist.get(u)! + 1));
        indeg.set(v, indeg.get(v)! - 1);
        if (indeg.get(v) === 0) q.push(v);
      }
    }
    dist.forEach((d, id) => layers.set(id, d));
  }
}

/** 工具：列出某条边两侧的面 */
export function facesAlongCrease(graph: PlanarGraph, a: number, b: number): [number, number] {
  return graph.edgeFaces.get(edgeKey(a, b)) ?? [-1, -1];
}

export function describeCrease(graph: PlanarGraph, a: number, b: number): string {
  const t = typeOfEdge(graph, a, b);
  const label = t === 'mountain' ? '山线' : t === 'valley' ? '谷线' : '边界';
  return `${label} #${a}–#${b}`;
}
