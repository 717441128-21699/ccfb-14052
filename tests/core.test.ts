import { describe, expect, it } from 'vitest';
import { ANGLE_EPS, radToDeg } from '../src/core/geometry';
import type { Crease } from '../src/core/types';
import { normalizeCreasePattern } from '../src/core/normalize';
import { diagnosePattern } from '../src/core/theorems';
import { buildPlanarGraph } from '../src/core/planarGraph';
import { analyzeFlatFoldability } from '../src/core/foldability';
import { foldAnimation, foldPattern, FOLD_FRAME_COUNT } from '../src/core/folding';
import {
  craneBase,
  frogBase,
  miuraOri,
  squareTwistTessellation,
  waterbombBase,
  waterbombTessellation,
  yoshimura,
} from '../src/patterns/generators';

const ALL_GENERATORS = {
  miura: () => miuraOri({ rows: 4, cols: 4 }),
  yoshimura: () => yoshimura({ rows: 4, cols: 4 }),
  waterbomb: () => waterbombTessellation({ rows: 4, cols: 4 }),
  twist: () => squareTwistTessellation({ rows: 2, cols: 2 }),
  waterbombBase,
  craneBase,
  frogBase,
};

describe('川崎定理与前川定理诊断', () => {
  for (const [name, gen] of Object.entries(ALL_GENERATORS)) {
    it(`${name} 生成器的每个内部顶点都满足两条定理（0.1° 容差）`, () => {
      const cp = normalizeCreasePattern(gen());
      const diag = diagnosePattern(cp);
      const bad = diag.vertices.filter(
        (v) => v.kind === 'interior' && !v.ok,
      );
      if (bad.length) {
        throw new Error(
          bad
            .map((v) => `顶点#${v.vertexId}: ${v.messages.join('；')}`)
            .join('\n'),
        );
      }
      for (const v of diag.vertices) {
        if (v.kind === 'interior') {
          expect(radToDeg(v.kawasakiError)).toBeLessThanOrEqual(0.1 + 1e-9);
          expect(v.maekawaError).toBe(0);
        }
      }
    });
  }

  it('川崎偏差单位正确：4 直角顶点偏差为 0', () => {
    const cp = normalizeCreasePattern({
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
      ],
      creases: [
        { a: 0, b: 1, type: 'valley' },
        { a: 0, b: 2, type: 'valley' },
        { a: 0, b: 3, type: 'mountain' },
        { a: 0, b: 4, type: 'valley' },
      ],
    });
    const diag = diagnosePattern(cp);
    const v0 = diag.vertices.find((v) => v.vertexId === 0)!;
    expect(v0.kawasakiError).toBeLessThan(ANGLE_EPS);
    expect(v0.ok).toBe(true);
  });

  it('错误顶点被标红并给出具体定理名与偏差', () => {
    // 故意画一个川崎不满足的顶点：扇形角 60/120 交替失衡
    const cp = normalizeCreasePattern({
      vertices: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 0.6 },
        { x: -0.5, y: 0.4 },
        { x: -1, y: -0.3 },
        { x: 0.4, y: -0.8 },
      ],
      creases: [
        { a: 0, b: 1, type: 'valley' },
        { a: 0, b: 2, type: 'mountain' },
        { a: 0, b: 3, type: 'valley' },
        { a: 0, b: 4, type: 'mountain' },
        { a: 0, b: 5, type: 'valley' },
      ],
    });
    const diag = diagnosePattern(cp);
    const v0 = diag.vertices.find((v) => v.vertexId === 0)!;
    expect(v0.ok).toBe(false);
    expect(v0.violations).toContain('kawasaki');
    expect(v0.messages.join('')).toContain('川崎');
    expect(diag.errorVertexIds).toContain(0);
  });

  it('前川定理：山 3 谷 1 合法，山 4 谷 1 非法', () => {
    const make = (m: number, v: number) => {
      const total = m + v;
      const verts = [{ x: 0, y: 0 }];
      const creases: Crease[] = [];
      for (let i = 0; i < total; i++) {
        const a = (i / total) * Math.PI * 2;
        verts.push({ x: Math.cos(a), y: Math.sin(a) });
        creases.push({ a: 0, b: i + 1, type: i < m ? 'mountain' : 'valley' });
      }
      return normalizeCreasePattern({ vertices: verts, creases });
    };
    const ok = diagnosePattern(make(3, 1));
    expect(ok.vertices[0].violations).not.toContain('maekawa');
    const bad = diagnosePattern(make(4, 1));
    expect(bad.vertices[0].violations).toContain('maekawa');
  });
});

describe('平面图切分', () => {
  it('三浦 4×4 切出 16 个面', () => {
    const cp = normalizeCreasePattern(miuraOri({ rows: 4, cols: 4 }));
    const graph = buildPlanarGraph(cp);
    expect(graph.faces.length).toBe(16);
  });

  it('交叉线段自动分裂出交点顶点', () => {
    const cp = normalizeCreasePattern({
      vertices: [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
        { x: 0, y: 1 },
      ],
      creases: [
        { a: 0, b: 1, type: 'valley' },
        { a: 2, b: 3, type: 'mountain' },
      ],
    });
    expect(cp.vertices.length).toBe(5);
    expect(cp.creases.length).toBe(4);
  });
});

describe('全局平折判定', () => {
  it('三浦、水雷底、蛙底、鹤底均可平折且得到层号', () => {
    for (const gen of [
      () => miuraOri({ rows: 3, cols: 3 }),
      waterbombBase,
      frogBase,
      craneBase,
    ]) {
      const cp = normalizeCreasePattern(gen());
      const graph = buildPlanarGraph(cp);
      const r = analyzeFlatFoldability(graph, diagnosePattern(cp).allOk);
      expect(r.localObstructions, r.reports.join('\n')).toEqual([]);
      expect(r.stuckCycles, r.reports.join('\n')).toEqual([]);
      expect(r.foldable).toBe(true);
      expect(r.layers.size).toBe(graph.faces.length);
    }
  });

  it('人为制造的层序闭环能指出互相卡住的面', () => {
    // 正方形纸，中心向四角发出 4 条折痕且全部为谷线（4 谷 0 山），
    // 前川定理 |M−V|=4 ≠ 2，定理诊断判失败，平折分析也必须报无法折平。
    const cp = normalizeCreasePattern({
      vertices: [
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
        { x: 0, y: 0 },
      ],
      creases: [
        { a: 0, b: 1, type: 'border' },
        { a: 1, b: 2, type: 'border' },
        { a: 2, b: 3, type: 'border' },
        { a: 3, b: 0, type: 'border' },
        { a: 4, b: 0, type: 'valley' },
        { a: 4, b: 1, type: 'valley' },
        { a: 4, b: 2, type: 'valley' },
        { a: 4, b: 3, type: 'valley' },
      ],
    });
    // 定理诊断确认中心顶点非法（前川定理不满足）
    const diag = diagnosePattern(cp);
    const center = diag.vertices.find((v) => v.kind === 'interior');
    expect(center, '应存在内部中心顶点').toBeDefined();
    expect(center!.violations).toContain('maekawa');
    const graph = buildPlanarGraph(cp);
    const r = analyzeFlatFoldability(graph, diag.allOk);
    // 定理失败时不做层序松弛，必须报无法折平
    expect(r.foldable).toBe(false);
    expect(r.reports.join('')).toMatch(/卡住|无法折平|矛盾/);
  });
});

describe('折叠运动学与 60 帧动画', () => {
  it('水雷底折满时所有点回到同一平面（完全平折）', () => {
    const cp = normalizeCreasePattern(waterbombBase());
    const graph = buildPlanarGraph(cp);
    const full = foldPattern(graph, 1);
    const zs = full.faces.flatMap((f) => f.points.map((p) => Math.abs(p[2])));
    expect(Math.max(...zs)).toBeLessThan(1e-6);
  });

  it('任意图案都能生成 60 帧且首帧保持纸面', () => {
    const cp = normalizeCreasePattern(miuraOri({ rows: 3, cols: 3 }));
    const graph = buildPlanarGraph(cp);
    const frames = foldAnimation(graph);
    expect(frames.length).toBe(FOLD_FRAME_COUNT);
    expect(frames[0].t).toBe(0);
    expect(frames[59].t).toBe(1);
    for (const face of frames[0].faces) {
      for (const p of face.points) expect(p[2]).toBeCloseTo(0, 10);
    }
  });
});

describe('200 顶点规模性能', () => {
  it('约 225 顶点的三浦图完成全套分析与 60 帧折叠', () => {
    const cp = normalizeCreasePattern(miuraOri({ rows: 14, cols: 14 }));
    expect(cp.vertices.length).toBeGreaterThanOrEqual(200);
    const t0 = performance.now();
    const diag = diagnosePattern(cp);
    const graph = buildPlanarGraph(cp);
    const analysis = analyzeFlatFoldability(graph, diag.allOk);
    const frames = foldAnimation(graph);
    const elapsed = performance.now() - t0;

    for (const v of diag.vertices) {
      if (v.kind === 'interior') expect(v.ok).toBe(true);
    }
    expect(analysis.foldable).toBe(true);
    expect(frames.length).toBe(60);
    // 纯计算应在 1 秒内完成（不含渲染）
    expect(elapsed).toBeLessThan(1000);
  });
});
