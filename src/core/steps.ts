import type { FlatFoldabilityResult } from './foldability';
import type { PlanarGraph } from './types';
import { edgeKey } from './types';
import type { FoldStep } from './svgExport';

/**
 * 由层序分析反推折法步骤：
 * 先折底层相邻的折痕（从纸外向中心收拢），同批按折痕长度从长到短，
 * 输出一步一折痕的顺序表，供步骤图导出使用。
 */
export function planFoldSteps(
  graph: PlanarGraph,
  analysis: FlatFoldabilityResult,
): FoldStep[] {
  const internal = graph.cp.creases.filter((c) => c.type !== 'border');
  const scored = internal.map((c) => {
    const sides = graph.edgeFaces.get(edgeKey(c.a, c.b));
    let level = 0;
    if (sides) {
      const l1 = analysis.layers.get(sides[0]) ?? 1;
      const l2 = sides[1] !== undefined ? (analysis.layers.get(sides[1]) ?? 1) : 1;
      level = Math.min(l1, l2);
    }
    const pa = graph.cp.vertices[c.a];
    const pb = graph.cp.vertices[c.b];
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    return { crease: c, level, len };
  });

  scored.sort((x, y) => x.level - y.level || y.len - x.len);

  return scored.map((s, i) => ({
    index: i + 1,
    title: `沿顶点 #${s.crease.a}–#${s.crease.b} 的${s.crease.type === 'valley' ? '谷线' : '山线'}折叠`,
    crease: [s.crease.a, s.crease.b] as [number, number],
    creaseType: s.crease.type as 'mountain' | 'valley',
  }));
}
