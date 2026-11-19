/** 折痕图核心数据结构 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 山线 / 谷线 / 纸张边界 */
export type CreaseType = 'mountain' | 'valley' | 'border';

export interface Crease {
  /** 端点顶点 id */
  a: number;
  b: number;
  type: CreaseType;
}

/** 折痕图：顶点 + 折线段 */
export interface CreasePattern {
  vertices: Vec2[];
  creases: Crease[];
}

/** 平面切分得到的面，顶点按逆时针排列 */
export interface Face {
  vertices: number[];
}

/** 半边结构平面图 */
export interface PlanarGraph {
  cp: CreasePattern;
  faces: Face[];
  /** 每条无向边（a<b）两侧的面 id，外侧为 -1 */
  edgeFaces: Map<string, [number, number]>;
  /** 每个面相邻的面：面 id -> 相邻面 id 列表（跨越内部折痕） */
  faceNeighbors: Map<number, number[]>;
}

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}
