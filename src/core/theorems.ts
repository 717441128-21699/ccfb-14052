import { ANGLE_EPS, angleOf, normAngle, radToDeg, sub } from './geometry';
import type { CreasePattern, CreaseType, Vec2 } from './types';

export type VertexKind = 'interior' | 'boundary' | 'dangling' | 'isolated';

export type ViolatedTheorem =
  | 'kawasaki'
  | 'maekawa'
  | 'degree-even'
  | 'topology';

export interface VertexDiagnosis {
  vertexId: number;
  kind: VertexKind;
  /** 按逆时针排列的相邻顶点 id */
  neighbors: number[];
  /** 与 neighbors 对应的扇形角（弧度），和为 2π（内部）或 <2π（边界） */
  sectorAngles: number[];
  mountainCount: number;
  valleyCount: number;
  /** 川崎偏差（弧度绝对值），越小越好 */
  kawasakiError: number;
  /** 前川偏差：|M−V|−2（内部顶点应为 0） */
  maekawaError: number;
  ok: boolean;
  violations: ViolatedTheorem[];
  /** 给设计师看的中文说明 */
  messages: string[];
}

export interface PatternDiagnosis {
  vertices: VertexDiagnosis[];
  /** 不满足定理的顶点 id */
  errorVertexIds: number[];
  allOk: boolean;
}

/** 判定顶点是内部还是边界：关联边里只要有 border 就算边界顶点 */
export function diagnosePattern(cp: CreasePattern): PatternDiagnosis {
  const n = cp.vertices.length;
  const incident: { to: number; type: CreaseType }[][] = Array.from(
    { length: n },
    () => [],
  );
  for (const c of cp.creases) {
    if (c.a === c.b) continue;
    incident[c.a].push({ to: c.b, type: c.type });
    incident[c.b].push({ to: c.a, type: c.type });
  }

  const vertices: VertexDiagnosis[] = [];
  const errorVertexIds: number[] = [];

  for (let id = 0; id < n; id++) {
    const d = diagnoseVertex(id, cp.vertices, incident[id]);
    vertices.push(d);
    if (!d.ok) errorVertexIds.push(id);
  }

  return { vertices, errorVertexIds, allOk: errorVertexIds.length === 0 };
}

function diagnoseVertex(
  id: number,
  allVerts: Vec2[],
  incident: { to: number; type: CreaseType }[],
): VertexDiagnosis {
  const origin = allVerts[id];
  const violations: ViolatedTheorem[] = [];
  const messages: string[] = [];

  let kind: VertexKind;
  if (incident.length === 0) kind = 'isolated';
  else if (incident.length < 2) kind = 'dangling';
  else if (incident.some((e) => e.type === 'border')) kind = 'boundary';
  else kind = 'interior';

  // 按极角逆时针排列相邻边
  const sorted = [...incident].sort(
    (a, b) =>
      angleOf(sub(allVerts[a.to], origin)) -
      angleOf(sub(allVerts[b.to], origin)),
  );
  const neighbors = sorted.map((e) => e.to);
  const angles = sorted.map((e) => angleOf(sub(allVerts[e.to], origin)));

  // 扇形角：相邻射线之间的夹角（最后一条绕回第一条）
  const sectorAngles: number[] = [];
  for (let i = 0; i < angles.length; i++) {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
    sectorAngles.push(normAngle(next - angles[i]));
  }

  let mountainCount = 0;
  let valleyCount = 0;
  for (const e of incident) {
    if (e.type === 'mountain') mountainCount++;
    else if (e.type === 'valley') valleyCount++;
  }

  let kawasakiError = 0;
  let maekawaError = 0;

  if (kind === 'isolated') {
    violations.push('topology');
    messages.push('孤立顶点：没有任何折痕或边界连接，请删除或补线。');
  } else if (kind === 'dangling') {
    violations.push('topology');
    messages.push('悬空端点：折痕必须终止于另一条折痕或纸张边界。');
  } else if (kind === 'interior') {
    // ---- 川崎定理：奇数位扇形角之和 = 偶数位之和 = π ----
    let oddSum = 0;
    let evenSum = 0;
    sectorAngles.forEach((a, i) => {
      if (i % 2 === 0) evenSum += a;
      else oddSum += a;
    });
    kawasakiError = Math.abs(oddSum - evenSum);
    if (kawasakiError > ANGLE_EPS) {
      violations.push('kawasaki');
      messages.push(
        `不满足川崎定理：隔角和之差为 ${radToDeg(kawasakiError).toFixed(3)}°，` +
          `需 ≤ 0.1°（当前隔角和 ${radToDeg(oddSum).toFixed(2)}° / ${radToDeg(evenSum).toFixed(2)}°）。`,
      );
    }

    // ---- 度数偶数：川崎定理隐含要求，但单独报更直观 ----
    if (incident.length % 2 !== 0) {
      violations.push('degree-even');
      messages.push(
        `内部顶点关联 ${incident.length} 条线，必须为偶数条（山、谷、边界交替计数）。`,
      );
    }

    // ---- 前川定理：M − V = ±2 ----
    maekawaError = Math.abs(Math.abs(mountainCount - valleyCount) - 2);
    if (maekawaError !== 0) {
      violations.push('maekawa');
      messages.push(
        `不满足前川定理：山线 ${mountainCount} 条、谷线 ${valleyCount} 条，` +
          `|山−谷| 必须等于 2，当前为 ${Math.abs(mountainCount - valleyCount)}。`,
      );
    }
  } else {
    // 边界顶点。川崎/前川的边界形式只对纸张平直边（内角 = π）上的点成立；
    // 纸张折角顶点（内角 ≠ π）不受这两个条件约束，跳过定理校验。
    const borderRays = sorted.filter((e) => e.type === 'border');
    let interiorTotal = sectorAngles.reduce((s, a) => s + a, 0);
    if (borderRays.length >= 2) {
      const maxSector = Math.max(...sectorAngles);
      interiorTotal = Math.PI * 2 - maxSector;
    }
    const onStraightEdge = Math.abs(interiorTotal - Math.PI) <= ANGLE_EPS;
    if (onStraightEdge) {
      kawasakiError = Math.abs(interiorTotal - Math.PI);
      const creaseEdges = incident.filter((e) => e.type !== 'border');
      if (kawasakiError > ANGLE_EPS) {
        violations.push('kawasaki');
        messages.push(
          `边界顶点不满足川崎边界条件：纸面内角之和为 ${radToDeg(interiorTotal).toFixed(2)}°，` +
            `应为 180°（偏差 ${radToDeg(kawasakiError).toFixed(3)}°）。`,
        );
      }
      if (creaseEdges.length >= 2 && Math.abs(mountainCount - valleyCount) !== 0) {
        violations.push('maekawa');
        messages.push(
          `边界顶点前川条件：山线 ${mountainCount} 条、谷线 ${valleyCount} 条，边界处山谷数应相等。`,
        );
      }
    }
  }

  return {
    vertexId: id,
    kind,
    neighbors,
    sectorAngles,
    mountainCount,
    valleyCount,
    kawasakiError,
    maekawaError,
    ok: violations.length === 0,
    violations,
    messages,
  };
}
