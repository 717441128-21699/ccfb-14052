/**
 * 折痕图编辑器：鼠标绘制、顶点/折痕选择、网格与角度吸附。
 * 维护一份可变 CreasePattern，所有写操作后回调通知 UI 重新诊断与渲染。
 */
import type { Vec2 } from '../core/types';
import {
  angleOf,
  pointOnSegment,
  snapAngle,
  snapToGrid,
  sub,
} from '../core/geometry';
import type { Crease, CreasePattern, CreaseType } from '../core/types';
import { edgeKey } from '../core/types';

export type EditorTool = 'select' | 'mountain' | 'valley' | 'border' | 'erase';

export interface EditorSettings {
  gridSize: number;
  snapGrid: boolean;
  snapAngle: boolean;
  angleStepDeg: number;
}

export class Editor {
  cp: CreasePattern;
  settings: EditorSettings = {
    gridSize: 0.25,
    snapGrid: true,
    snapAngle: true,
    angleStepDeg: 15,
  };
  selectedVertex: number | null = null;
  /** 当前正在拖拽的折痕起点（绘制模式） */
  pendingStart: number | null = null;
  onChange: () => void = () => {};

  constructor(initial?: CreasePattern) {
    this.cp = initial
      ? structuredClone(initial)
      : { vertices: [], creases: [] };
  }

  load(cp: CreasePattern): void {
    this.cp = structuredClone(cp);
    this.selectedVertex = null;
    this.pendingStart = null;
    this.onChange();
  }

  /** 屏幕坐标（纸面单位）→ 吸附后的纸面坐标 */
  snap(p: Vec2): Vec2 {
    let out = p;
    if (this.settings.snapGrid) {
      out = snapToGrid(out, this.settings.gridSize);
    }
    return out;
  }

  /** 找距 p 最近的顶点（阈值内），没有则新建并返回 id */
  vertexAt(p: Vec2, threshold = 0.12): number {
    let best = -1;
    let bestD = threshold;
    for (let i = 0; i < this.cp.vertices.length; i++) {
      const d = Math.hypot(this.cp.vertices[i].x - p.x, this.cp.vertices[i].y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private addVertex(p: Vec2): number {
    const id = this.cp.vertices.length;
    this.cp.vertices.push({ x: p.x, y: p.y });
    return id;
  }

  /** 指针按下：选择工具选顶点，折痕工具开始画线 */
  pointerDown(p: Vec2, tool: EditorTool): void {
    const sp = this.snap(p);
    if (tool === 'select') {
      this.selectedVertex = this.vertexAt(sp);
      this.onChange();
      return;
    }
    if (tool === 'erase') {
      this.eraseAt(sp);
      return;
    }
    let id = this.vertexAt(sp);
    if (id < 0) id = this.addVertex(sp);
    this.pendingStart = id;
    this.selectedVertex = id;
  }

  /** 指针移动：拖拽已有顶点或为待画折痕计算吸附角度 */
  pointerMove(p: Vec2, tool: EditorTool): Vec2 {
    const sp = this.snap(p);
    if (tool === 'select' && this.selectedVertex !== null && this.pendingStart === null) {
      this.cp.vertices[this.selectedVertex] = sp;
      this.onChange();
      return sp;
    }
    if (this.pendingStart !== null && this.settings.snapAngle) {
      const a = this.cp.vertices[this.pendingStart];
      const ang = angleOf(sub(sp, a));
      const snapped = snapAngle(ang, (this.settings.angleStepDeg * Math.PI) / 180);
      const len = Math.hypot(sp.x - a.x, sp.y - a.y);
      return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
    }
    return sp;
  }

  /** 指针抬起：落一条折痕（自动 T 接/吸附到已有顶点） */
  pointerUp(p: Vec2, tool: EditorTool): void {
    if (this.pendingStart === null) return;
    const start = this.pendingStart;
    this.pendingStart = null;
    let end = this.snap(p);
    let endId = this.vertexAt(end);
    if (endId < 0) {
      // 角度吸附后的落点
      if (this.settings.snapAngle) end = this.pointerMove(p, tool);
      endId = this.addVertex(end);
    }
    if (endId === start) {
      this.onChange();
      return;
    }
    const type: CreaseType =
      tool === 'mountain' ? 'mountain' : tool === 'valley' ? 'valley' : 'border';
    this.addCrease(start, endId, type);
    this.onChange();
  }

  /** 加折痕；若穿过已有线段则在交点处分裂（交给 normalize 统一处理） */
  addCrease(a: number, b: number, type: CreaseType): void {
    const key = edgeKey(a, b);
    const existing = this.cp.creases.find(
      (c) => edgeKey(c.a, c.b) === key,
    );
    if (existing) {
      existing.type = type;
      return;
    }
    this.cp.creases.push({ a, b, type });
  }

  eraseAt(p: Vec2): void {
    const vid = this.vertexAt(p);
    if (vid >= 0) {
      this.cp.creases = this.cp.creases.filter((c) => c.a !== vid && c.b !== vid);
      this.selectedVertex = null;
      this.onChange();
      return;
    }
    // 否则删除距指针最近的折痕
    let best = -1;
    let bestD = 0.12;
    this.cp.creases.forEach((c, i) => {
      const a = this.cp.vertices[c.a];
      const b = this.cp.vertices[c.b];
      if (pointOnSegment(p, a, b, bestD)) best = i;
    });
    if (best >= 0) {
      this.cp.creases.splice(best, 1);
      this.onChange();
    }
  }

  /** 切换选中折痕（或顶点关联折痕）的山/谷类型 */
  toggleSelectedCreaseType(): void {
    if (this.selectedVertex === null) return;
    const v = this.selectedVertex;
    const c = this.cp.creases.find((x) => x.a === v || x.b === v);
    if (!c || c.type === 'border') return;
    c.type = c.type === 'mountain' ? 'valley' : 'mountain';
    this.onChange();
  }

  clear(): void {
    this.cp = { vertices: [], creases: [] };
    this.selectedVertex = null;
    this.onChange();
  }
}

export function creaseLabel(c: Crease): string {
  return c.type === 'mountain' ? '山线' : c.type === 'valley' ? '谷线' : '边界';
}
