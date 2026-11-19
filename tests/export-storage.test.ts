import { describe, expect, it, beforeEach } from 'vitest';
import { miuraOri, waterbombBase } from '../src/patterns/generators';
import { normalizeCreasePattern } from '../src/core/normalize';
import { buildPlanarGraph } from '../src/core/planarGraph';
import { analyzeFlatFoldability } from '../src/core/foldability';
import { diagnosePattern } from '../src/core/theorems';
import {
  exportCreasePatternSvg,
  exportLayerSvg,
  exportAllStepSvgs,
} from '../src/core/svgExport';
import { planFoldSteps } from '../src/core/steps';
import {
  createWork,
  listWorks,
  saveVersion,
  getWork,
  exportWorkJson,
  importWorkJson,
} from '../src/core/storage';

// localStorage 极简内存实现
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
// 测试环境注入内存版 localStorage
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
  new MemoryStorage();

describe('SVG 导出', () => {
  it('折痕图 SVG 包含山线、谷线、边界三种线型', () => {
    const cp = normalizeCreasePattern(miuraOri({ rows: 2, cols: 2 }));
    const svg = exportCreasePatternSvg(cp);
    expect(svg).toContain('<svg');
    expect(svg).toContain('stroke-dasharray'); // 山线虚线
    expect(svg).toContain('#1565d8'); // 谷线蓝
    expect(svg).toContain('</svg>');
  });

  it('可平折图案能导出层序图与全部折法步骤图', () => {
    const cp = normalizeCreasePattern(waterbombBase());
    const graph = buildPlanarGraph(cp);
    const analysis = analyzeFlatFoldability(graph, diagnosePattern(cp).allOk);
    expect(analysis.foldable).toBe(true);

    const layerSvg = exportLayerSvg(graph, analysis);
    expect(layerSvg).toContain('<svg');
    expect(layerSvg).toContain('层');

    const steps = planFoldSteps(graph, analysis);
    expect(steps.length).toBeGreaterThan(0);
    const svgs = exportAllStepSvgs(cp, steps);
    expect(svgs.length).toBe(steps.length);
    for (const svg of svgs) {
      expect(svg).toContain('第');
      expect(svg).toContain('</svg>');
    }
  });
});

describe('本地作品与版本存储', () => {
  beforeEach(() => localStorage.clear());

  it('创建作品、追加版本、重新读取', () => {
    const cp = normalizeCreasePattern(waterbombBase());
    const work = createWork('测试水雷底', cp);
    expect(work.versions.length).toBe(1);
    const updated = saveVersion(work.id, cp, '第二个版本');
    expect(updated.versions.length).toBe(2);
    expect(listWorks().length).toBe(1);
    const reloaded = getWork(work.id)!;
    expect(reloaded.versions[1].note).toBe('第二个版本');
    expect(reloaded.versions[1].cp.vertices.length).toBe(cp.vertices.length);
  });

  it('作品 JSON 可导出并重新导入', () => {
    const work = createWork('导出测试', normalizeCreasePattern(waterbombBase()));
    const json = exportWorkJson(work);
    expect(() => JSON.parse(json)).not.toThrow();
    localStorage.clear();
    const imported = importWorkJson(json);
    expect(imported.name).toBe('导出测试');
    expect(listWorks().length).toBe(1);
  });
});
