import type { FlatFoldabilityResult } from './foldability';
import type { CreasePattern, PlanarGraph, Vec2 } from './types';
import { edgeKey } from './types';

const MOUNTAIN_COLOR = '#d92d20';
const VALLEY_COLOR = '#1565d8';
const BORDER_COLOR = '#1d2939';
const ERROR_COLOR = '#ff0000';

export interface SvgOptions {
  /** 画布内边距（纸面单位） */
  padding?: number;
  /** 错误顶点 id 集合，标红 */
  errorVertexIds?: Iterable<number>;
  /** 是否绘制顶点编号 */
  showVertexLabels?: boolean;
  /** 层号着色：面 id -> 层号 */
  layers?: Map<number, number>;
  /** 图面标题 */
  title?: string;
}

/** 导出折痕图 SVG（山线红虚线、谷线蓝点划线、边界黑实线，错误顶点红圈） */
export function exportCreasePatternSvg(cp: CreasePattern, opts: SvgOptions = {}): string {
  const pad = opts.padding ?? 0.5;
  const bounds = boundsOf(cp.vertices, pad);
  const parts: string[] = [];
  parts.push(header(bounds, opts.title ?? '折痕图'));

  parts.push('<g id="creases" fill="none" stroke-linecap="round">');
  for (const c of cp.creases) {
    const a = cp.vertices[c.a];
    const b = cp.vertices[c.b];
    if (c.type === 'mountain') {
      parts.push(
        `  <line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" ` +
          `stroke="${MOUNTAIN_COLOR}" stroke-width="0.04" stroke-dasharray="0.22,0.12"/>`,
      );
    } else if (c.type === 'valley') {
      parts.push(
        `  <line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" ` +
          `stroke="${VALLEY_COLOR}" stroke-width="0.04" stroke-dasharray="0.06,0.08,0.2,0.08"/>`,
      );
    } else {
      parts.push(
        `  <line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" ` +
          `stroke="${BORDER_COLOR}" stroke-width="0.06"/>`,
      );
    }
  }
  parts.push('</g>');

  const errors = new Set(opts.errorVertexIds ?? []);
  parts.push('<g id="vertices">');
  cp.vertices.forEach((v, id) => {
    const bad = errors.has(id);
    parts.push(
      `  <circle cx="${f(v.x)}" cy="${f(v.y)}" r="${bad ? 0.12 : 0.05}" ` +
        `fill="${bad ? ERROR_COLOR : '#344054'}"${bad ? ` stroke="#fff" stroke-width="0.03"` : ''}/>`,
    );
    if (bad || opts.showVertexLabels) {
      parts.push(
        `  <text x="${f(v.x + 0.14)}" y="${f(v.y - 0.12)}" font-size="0.22" ` +
          `fill="${bad ? ERROR_COLOR : '#475467'}" font-family="sans-serif">#${id}</text>`,
      );
    }
  });
  parts.push('</g>');

  parts.push(legend());
  parts.push('</svg>');
  return parts.join('\n');
}

/** 层序着色图：按每块纸的层号从浅到深填色 */
export function exportLayerSvg(
  graph: PlanarGraph,
  analysis: FlatFoldabilityResult,
): string {
  const pad = 0.5;
  const bounds = boundsOf(graph.cp.vertices, pad);
  const parts: string[] = [header(bounds, '平折层序图（数字为层号）')];
  const maxLayer = Math.max(1, ...analysis.layers.values());

  parts.push('<g id="faces" stroke="#ffffff" stroke-width="0.03">');
  graph.faces.forEach((face, fid) => {
    const layer = analysis.layers.get(fid) ?? 1;
    const t01 = (layer - 1) / Math.max(1, maxLayer - 1);
    const fill = layerColor(t01);
    const pts = face.vertices
      .map((vid) => `${f(graph.cp.vertices[vid].x)},${f(graph.cp.vertices[vid].y)}`)
      .join(' ');
    parts.push(`  <polygon points="${pts}" fill="${fill}"/>`);
    const c = centroidOf(graph, fid);
    parts.push(
      `  <text x="${f(c.x)}" y="${f(c.y)}" font-size="0.3" text-anchor="middle" ` +
        `fill="#101828" font-family="sans-serif" font-weight="bold">${layer}</text>`,
    );
  });
  parts.push('</g>');

  parts.push('<g id="borders" fill="none">');
  for (const c of graph.cp.creases) {
    if (c.type === 'border') {
      const a = graph.cp.vertices[c.a];
      const b = graph.cp.vertices[c.b];
      parts.push(
        `  <line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" ` +
          `stroke="${BORDER_COLOR}" stroke-width="0.06"/>`,
      );
    }
  }
  parts.push('</g>');
  parts.push('</svg>');
  return parts.join('\n');
}

export interface FoldStep {
  index: number;
  title: string;
  crease: [number, number];
  creaseType: 'mountain' | 'valley';
}

/**
 * 折法步骤图：一步一张 SVG。
 * 在当前折痕图上高亮该步要折的折痕，并给出步骤号与山谷说明。
 */
export function exportStepSvg(
  cp: CreasePattern,
  step: FoldStep,
  doneCreases: Set<string>,
): string {
  const pad = 0.5;
  const bounds = boundsOf(cp.vertices, pad);
  const parts: string[] = [header(bounds, `第 ${step.index} 步：${step.title}`)];
  const key = edgeKey(step.crease[0], step.crease[1]);

  parts.push('<g fill="none" stroke-linecap="round">');
  for (const c of cp.creases) {
    const a = cp.vertices[c.a];
    const b = cp.vertices[c.b];
    const ck = edgeKey(c.a, c.b);
    const isCurrent = ck === key;
    const isDone = doneCreases.has(ck);
    const width = isCurrent ? 0.09 : 0.04;
    let color = BORDER_COLOR;
    let dash = '';
    if (c.type === 'mountain') {
      color = isCurrent ? '#b42318' : isDone ? '#f0a19b' : MOUNTAIN_COLOR;
      dash = 'stroke-dasharray="0.22,0.12"';
    } else if (c.type === 'valley') {
      color = isCurrent ? '#0b4db0' : isDone ? '#9fc0f2' : VALLEY_COLOR;
      dash = 'stroke-dasharray="0.06,0.08,0.2,0.08"';
    }
    parts.push(
      `  <line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" ` +
        `stroke="${color}" stroke-width="${width}" ${dash}/>`,
    );
  }
  parts.push('</g>');

  // 步骤标记：在折痕中点放序号圆
  const a = cp.vertices[step.crease[0]];
  const b = cp.vertices[step.crease[1]];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  parts.push(
    `<circle cx="${f(mx)}" cy="${f(my)}" r="0.22" fill="${step.creaseType === 'valley' ? VALLEY_COLOR : MOUNTAIN_COLOR}" stroke="#fff" stroke-width="0.04"/>`,
  );
  parts.push(
    `<text x="${f(mx)}" y="${f(my + 0.09)}" font-size="0.28" text-anchor="middle" ` +
      `fill="#fff" font-family="sans-serif" font-weight="bold">${step.index}</text>`,
  );
  parts.push(
    `<text x="${bounds.minX + 0.2}" y="${bounds.maxY + 0.35}" font-size="0.26" ` +
      `fill="#344054" font-family="sans-serif">${step.creaseType === 'valley' ? '谷折（向内合拢）' : '山折（向外拱起）'}</text>`,
  );
  parts.push('</svg>');
  return parts.join('\n');
}

/** 一次导出整套折法步骤（返回每张 SVG 字符串） */
export function exportAllStepSvgs(cp: CreasePattern, steps: FoldStep[]): string[] {
  const done = new Set<string>();
  return steps.map((step) => {
    const svg = exportStepSvg(cp, step, new Set(done));
    done.add(edgeKey(step.crease[0], step.crease[1]));
    return svg;
  });
}

interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
  maxY: number;
}

function boundsOf(verts: Vec2[], pad: number): Bounds {
  const xs = verts.map((v) => v.x);
  const ys = verts.map((v) => v.y);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  return { minX, minY, width: maxX - minX, height: maxY - minY, maxY };
}

function header(b: Bounds, title: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(b.minX)} ${f(b.minY)} ${f(b.width)} ${f(b.height)}" ` +
      `width="640" height="${Math.round((640 * b.height) / b.width)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="${f(b.minX)}" y="${f(b.minY)}" width="${f(b.width)}" height="${f(b.height)}" fill="#fcfcfd"/>`,
  ].join('\n');
}

function legend(): string {
  return [
    '<g font-family="sans-serif" font-size="0.22" fill="#344054">',
    '  <line x1="0.4" y1="-0.15" x2="0.9" y2="-0.15" stroke="' + MOUNTAIN_COLOR + '" stroke-width="0.04" stroke-dasharray="0.22,0.12"/>',
    '  <text x="1.0" y="-0.08">山线</text>',
    '  <line x1="1.9" y1="-0.15" x2="2.4" y2="-0.15" stroke="' + VALLEY_COLOR + '" stroke-width="0.04" stroke-dasharray="0.06,0.08,0.2,0.08"/>',
    '  <text x="2.5" y="-0.08">谷线</text>',
    '</g>',
  ].join('\n');
}

function layerColor(t: number): string {
  // 浅黄 → 深青
  const r = Math.round(254 - 170 * t);
  const g = Math.round(243 - 90 * t);
  const b = Math.round(199 + 30 * t);
  return `rgb(${r},${g},${b})`;
}

function centroidOf(graph: PlanarGraph, faceId: number): Vec2 {
  const verts = graph.faces[faceId].vertices;
  let x = 0;
  let y = 0;
  for (const vid of verts) {
    x += graph.cp.vertices[vid].x;
    y += graph.cp.vertices[vid].y;
  }
  return { x: x / verts.length, y: y / verts.length };
}

function f(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
