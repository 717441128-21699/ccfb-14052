/**
 * WebGL2 渲染器：支持 2D 折痕图编辑视图与 3D 折叠动画视图。
 * 零依赖，手写着色器与缓冲管理；线框 + 半透明面混合绘制。
 */
import type { CreasePattern, PlanarGraph, Vec2 } from '../core/types';
import type { FoldedState } from '../core/folding';
import { lookAt4, multiply4, perspective4, type Mat4 } from '../core/math3d';

const VERT_2D = `#version 300 es
layout(location=0) in vec2 a_pos;
uniform vec2 u_scale;
uniform vec2 u_translate;
void main() {
  gl_Position = vec4(a_pos * u_scale + u_translate, 0.0, 1.0);
}`;

const FRAG_COLOR = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`;

const VERT_3D = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private prog2d: WebGLProgram;
  private prog3d: WebGLProgram;
  private vbo: WebGLBuffer;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.prog2d = program(gl, VERT_2D, FRAG_COLOR);
    this.prog3d = program(gl, VERT_3D, FRAG_COLOR);
    this.vbo = gl.createBuffer()!;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.96, 0.96, 0.95, 1);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  /** 2D 视图：画折痕线、面填充、顶点 */
  draw2D(
    cp: CreasePattern,
    opts: {
      errorVertexIds?: Set<number>;
      highlightFaces?: Set<number>;
      graph?: PlanarGraph;
    } = {},
  ): void {
    const gl = this.gl;
    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog2d);

    const bounds = boundsOf(cp.vertices);
    const scale = compute2DScale(bounds, this.canvas.width, this.canvas.height);
    const uScale = gl.getUniformLocation(this.prog2d, 'u_scale');
    const uTrans = gl.getUniformLocation(this.prog2d, 'u_translate');
    gl.uniform2f(uScale, scale.x, scale.y);
    gl.uniform2f(uTrans, scale.tx, scale.ty);

    // 面填充
    if (opts.graph) {
      for (let fid = 0; fid < opts.graph.faces.length; fid++) {
        const face = opts.graph.faces[fid];
        const pts: number[] = [];
        for (const vid of face.vertices) {
          pts.push(cp.vertices[vid].x, cp.vertices[vid].y);
        }
        const highlighted = opts.highlightFaces?.has(fid);
        this.drawTriangles2D(pts, highlighted ? RGBA.facetHi : RGBA.facet);
      }
    }

    // 折痕线
    gl.lineWidth(2);
    for (const c of cp.creases) {
      const a = cp.vertices[c.a];
      const b = cp.vertices[c.b];
      const color =
        c.type === 'mountain' ? RGBA.mountain : c.type === 'valley' ? RGBA.valley : RGBA.border;
      this.drawLines2D([a.x, a.y, b.x, b.y], color);
    }

    // 顶点
    for (let id = 0; id < cp.vertices.length; id++) {
      const p = cp.vertices[id];
      const bad = opts.errorVertexIds?.has(id);
      this.drawPoint2D(p.x, p.y, bad ? RGBA.error : RGBA.vertex, bad ? 9 : 5);
    }
  }

  /** 3D 视图：画某一折叠帧的所有面与棱 */
  draw3D(state: FoldedState): void {
    const gl = this.gl;
    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog3d);

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = perspective4((Math.PI / 180) * 40, aspect, 0.1, 100);
    const eye = [3.2, -4.2, 3.4] as const;
    const view = lookAt4([eye[0], eye[1], eye[2]], [0, 0, 0], [0, 0, 1]);
    const mvp = multiply4(proj, view);
    const uMvp = gl.getUniformLocation(this.prog3d, 'u_mvp');
    const uColor = gl.getUniformLocation(this.prog3d, 'u_color');
    gl.uniformMatrix4fv(uMvp, false, mvp);

    for (const face of state.faces) {
      const flat: number[] = [];
      for (const p of face.points) flat.push(p[0], p[1], p[2]);
      this.drawTriangles3D(flat, RGBA.facet3d);
      // 棱线
      const edges: number[] = [];
      for (let i = 0; i < face.points.length; i++) {
        const a = face.points[i];
        const b = face.points[(i + 1) % face.points.length];
        edges.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
      gl.uniform4fv(uColor, RGBA.edge3d);
      this.drawLines3D(edges);
    }
    gl.disable(gl.DEPTH_TEST);
  }

  private bindAndDraw(data: number[], mode: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    const dim = gl.getParameter(gl.CURRENT_PROGRAM) === this.prog3d ? 3 : 2;
    gl.vertexAttribPointer(0, dim, gl.FLOAT, false, 0, 0);
    gl.drawArrays(mode, 0, data.length / dim);
  }

  private drawLines2D(data: number[], color: number[]): void {
    const gl = this.gl;
    gl.uniform4fv(gl.getUniformLocation(this.prog2d, 'u_color'), color);
    this.bindAndDraw(data, gl.LINES);
  }

  private drawTriangles2D(data: number[], color: number[]): void {
    const gl = this.gl;
    gl.uniform4fv(gl.getUniformLocation(this.prog2d, 'u_color'), color);
    // 扇面三角化
    const tris = fanTriangulate(data, 2);
    this.bindAndDraw(tris, gl.TRIANGLES);
  }

  private drawPoint2D(x: number, y: number, color: number[], size: number): void {
    const gl = this.gl;
    const r = size / Math.max(1, this.canvas.width);
    const verts: number[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      verts.push(x + Math.cos(a) * r * 2, y + Math.sin(a) * r * 2);
    }
    gl.uniform4fv(gl.getUniformLocation(this.prog2d, 'u_color'), color);
    this.bindAndDraw(verts, gl.TRIANGLE_FAN);
  }

  private drawTriangles3D(data: number[], color: number[]): void {
    const gl = this.gl;
    gl.uniform4fv(gl.getUniformLocation(this.prog3d, 'u_color'), color);
    const tris = fanTriangulate(data, 3);
    this.bindAndDraw(tris, gl.TRIANGLES);
  }

  private drawLines3D(data: number[]): void {
    this.bindAndDraw(data, this.gl.LINES);
  }
}

const RGBA = {
  mountain: [0.85, 0.18, 0.13, 1],
  valley: [0.08, 0.4, 0.85, 1],
  border: [0.11, 0.16, 0.22, 1],
  vertex: [0.2, 0.25, 0.33, 1],
  error: [1, 0, 0, 1],
  facet: [0.75, 0.8, 0.9, 0.35],
  facetHi: [1, 0.85, 0.4, 0.55],
  facet3d: [0.72, 0.78, 0.92, 0.85],
  edge3d: [0.2, 0.26, 0.38, 0.9],
};

function fanTriangulate(data: number[], dim: number): number[] {
  const count = data.length / dim;
  const out: number[] = [];
  for (let i = 1; i < count - 1; i++) {
    for (const k of [0, i, i + 1]) {
      for (let d = 0; d < dim; d++) out.push(data[k * dim + d]);
    }
  }
  return out;
}

interface Bounds2D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function boundsOf(verts: Vec2[]): Bounds2D {
  return {
    minX: Math.min(...verts.map((v) => v.x)),
    maxX: Math.max(...verts.map(v => v.x)),
    minY: Math.min(...verts.map((v) => v.y)),
    maxY: Math.max(...verts.map(v => v.y)),
  };
}

function compute2DScale(b: Bounds2D, cw: number, ch: number): { x: number; y: number; tx: number; ty: number } {
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const pad = 0.85;
  const sx = (pad * 2) / w;
  const sy = (pad * 2) / h;
  const s = Math.min((cw / ch) * sy, sx);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { x: s, y: -s, tx: -cx * s, ty: cy * s };
}

export type { Mat4 };
