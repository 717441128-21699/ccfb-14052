/**
 * 工作室主控制器：连接编辑器、定理诊断、平折分析、折叠动画、
 * 本地版本存储与 SVG 导出，驱动整体 UI。
 */
import './styles.css';
import { Editor, type EditorTool } from './editor';
import { Renderer } from '../gl/renderer';
import { normalizeCreasePattern } from '../core/normalize';
import { diagnosePattern, type PatternDiagnosis } from '../core/theorems';
import { buildPlanarGraph } from '../core/planarGraph';
import { analyzeFlatFoldability, type FlatFoldabilityResult } from '../core/foldability';
import { foldAnimation, foldPattern, FOLD_FRAME_COUNT, type FoldedState } from '../core/folding';
import {
  exportCreasePatternSvg,
  exportLayerSvg,
  exportAllStepSvgs,
} from '../core/svgExport';
import { planFoldSteps } from '../core/steps';
import {
  createWork,
  deleteWork,
  exportWorkJson,
  getWork,
  importWorkJson,
  listWorks,
  renameWork,
  saveVersion,
  type Work,
} from '../core/storage';
import {
  craneBase,
  frogBase,
  miuraOri,
  squareTwistTessellation,
  waterbombBase,
  waterbombTessellation,
  yoshimura,
} from '../patterns/generators';
import type { CreasePattern } from '../core/types';

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel)!;

class StudioApp {
  private editor = new Editor();
  private renderer!: Renderer;
  private renderer3d!: Renderer;
  private tool: EditorTool = 'select';
  private mode: '2d' | '3d' = '2d';
  private diagnosis: PatternDiagnosis | null = null;
  private analysis: FlatFoldabilityResult | null = null;
  private frames: FoldedState[] = [];
  private frameIdx = 0;
  private playTimer: number | null = null;
  private currentWork: Work | null = null;

  constructor() {
    this.renderer = new Renderer($('#canvas2d'));
    this.renderer3d = new Renderer($('#canvas3d'));
    this.bindTools();
    this.bindCanvas();
    this.bindPanels();
    this.refreshWorks();
    this.loadPattern(miuraOri({ rows: 3, cols: 3 }));
    this.loop();
  }

  // ---------- 工具与画布 ----------
  private bindTools(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.tool = btn.dataset.tool as EditorTool;
        document.querySelectorAll('[data-tool]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode as '2d' | '3d';
        $('#canvas2d').style.display = this.mode === '2d' ? 'block' : 'none';
        $('#canvas3d').style.display = this.mode === '3d' ? 'block' : 'none';
        $('#panel2d').style.display = this.mode === '2d' ? 'block' : 'none';
        $('#panel3d').style.display = this.mode === '3d' ? 'block' : 'none';
        if (this.mode === '3d') this.ensureAnimation();
      });
    });
  }

  private toPaper(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = $('#canvas2d') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    // 反推纸面坐标（与 renderer 的 compute2DScale 对应）
    const verts = this.editor.cp.vertices;
    if (verts.length === 0) return { x: nx * 5, y: ny * 5 };
    const minX = Math.min(...verts.map((v) => v.x));
    const maxX = Math.max(...verts.map(v => v.x));
    const minY = Math.min(...verts.map((v) => v.y));
    const maxY = Math.max(...verts.map(v => v.y));
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const s = Math.min((rect.width / rect.height) * (1.7 / h), 1.7 / w);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    // renderer 中 gl_Position = p*s + t，其中 tx=-cx*s、ty=cy*s，这里求逆
    return { x: (nx + cx * s) / s, y: (-ny + cy * s) / s };
  }

  private bindCanvas(): void {
    const canvas = $('#canvas2d') as HTMLCanvasElement;
    canvas.addEventListener('pointerdown', (e) => {
      const p = this.toPaper(e.clientX, e.clientY);
      this.editor.pointerDown(p, this.tool);
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.toPaper(e.clientX, e.clientY);
      this.editor.pointerMove(p, this.tool);
    });
    window.addEventListener('pointerup', (e) => {
      const p = this.toPaper(e.clientX, e.clientY);
      this.editor.pointerUp(p, this.tool);
    });
  }

  // ---------- 面板按钮 ----------
  private bindPanels(): void {
    $('#gridSnap').addEventListener('change', (e) => {
      this.editor.settings.snapGrid = (e.target as HTMLInputElement).checked;
    });
    $('#angleSnap').addEventListener('change', (e) => {
      this.editor.settings.snapAngle = (e.target as HTMLInputElement).checked;
    });
    $('#gridSize').addEventListener('change', (e) => {
      this.editor.settings.gridSize = parseFloat((e.target as HTMLInputElement).value) || 0.25;
    });
    $('#angleStep').addEventListener('change', (e) => {
      this.editor.settings.angleStepDeg = parseFloat((e.target as HTMLInputElement).value) || 15;
    });
    $('#toggleType').addEventListener('click', () => this.editor.toggleSelectedCreaseType());
    $('#clearBtn').addEventListener('click', () => {
      this.editor.clear();
      this.analysis = null;
      this.diagnosis = null;
    });
    $('#analyzeBtn').addEventListener('click', () => this.runAnalysis(true));

    // 经典图案
    document.querySelectorAll<HTMLButtonElement>('[data-pattern]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.pattern!;
        const cp = this.generate(name);
        if (cp) this.loadPattern(cp);
      });
    });

    // 动画控制
    $('#playBtn').addEventListener('click', () => this.togglePlay());
    $('#frameSlider').addEventListener('input', (e) => {
      this.frameIdx = parseInt((e.target as HTMLInputElement).value, 10);
      this.pause();
    });

    // 存储
    $('#newWork').addEventListener('click', () => this.saveNewWork());
    $('#saveVersion').addEventListener('click', () => this.saveNewVersion());
    $('#renameWork').addEventListener('click', () => this.renameCurrent());
    $('#deleteWork').addEventListener('click', () => this.deleteCurrent());
    $('#exportJson').addEventListener('click', () => this.exportJson());
    $('#importJson').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (e) => this.importJsonFile(e));

    // SVG 导出
    $('#exportSvg').addEventListener('click', () => this.exportSvg());
    $('#exportLayerSvg').addEventListener('click', () => this.exportLayer());
    $('#exportSteps').addEventListener('click', () => this.exportStepDiagrams());
  }

  private generate(name: string): CreasePattern | null {
    switch (name) {
      case 'miura': return miuraOri({ rows: 4, cols: 4 });
      case 'yoshimura': return yoshimura({ rows: 4, cols: 4 });
      case 'waterbomb': return waterbombTessellation({ rows: 4, cols: 4 });
      case 'twist': return squareTwistTessellation({ rows: 2, cols: 2 });
      case 'waterbombBase': return waterbombBase();
      case 'craneBase': return craneBase();
      case 'frogBase': return frogBase();
      default: return null;
    }
  }

  private loadPattern(cp: CreasePattern): void {
    this.editor.load(cp);
    this.analysis = null;
    this.diagnosis = null;
    this.frames = [];
    this.runAnalysis(false);
  }

  // ---------- 分析 ----------
  private normalized(): CreasePattern {
    return normalizeCreasePattern(this.editor.cp);
  }

  private runAnalysis(verbose: boolean): void {
    const cp = this.normalized();
    this.editor.cp = cp;
    this.diagnosis = diagnosePattern(cp);
    const graph = buildPlanarGraph(cp);
    this.analysis = analyzeFlatFoldability(graph, this.diagnosis.allOk);
    this.frames = [];
    this.frameIdx = 0;
    this.renderInspector();
    if (verbose) this.toast(this.analysis.foldable ? '平折判定通过' : '存在无法平折的冲突');
  }

  private ensureAnimation(): void {
    if (this.frames.length === 0) {
      const cp = this.normalized();
      const graph = buildPlanarGraph(cp);
      this.frames = foldAnimation(graph);
      const slider = $('#frameSlider') as HTMLInputElement;
      slider.max = String(FOLD_FRAME_COUNT - 1);
    }
  }

  private togglePlay(): void {
    if (this.playTimer !== null) {
      this.pause();
      return;
    }
    this.ensureAnimation();
    $('#playBtn').textContent = '暂停';
    this.playTimer = window.setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % FOLD_FRAME_COUNT;
      ($('#frameSlider') as HTMLInputElement).value = String(this.frameIdx);
      $('#frameLabel').textContent = `第 ${this.frameIdx + 1} / ${FOLD_FRAME_COUNT} 帧`;
    }, 1000 / 30);
  }

  private pause(): void {
    if (this.playTimer !== null) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    $('#playBtn').textContent = '播放 60 帧';
  }

  // ---------- 渲染 ----------
  private loop = (): void => {
    const cp = this.editor.cp;
    if (this.mode === '2d') {
      const errorSet = new Set(this.diagnosis?.errorVertexIds ?? []);
      let graph;
      try {
        graph = buildPlanarGraph(cp);
      } catch {
        graph = undefined;
      }
      this.renderer.draw2D(cp, {
        errorVertexIds: errorSet,
        highlightFaces: new Set(this.analysis?.stuckCycles.flatMap((c) => c.faceIds) ?? []),
        graph,
      });
    } else {
      this.ensureAnimation();
      const state = this.frames[this.frameIdx] ?? foldPattern(buildPlanarGraph(cp), 0);
      this.renderer3d.draw3D(state);
      $('#frameLabel').textContent = `第 ${this.frameIdx + 1} / ${FOLD_FRAME_COUNT} 帧`;
    }
    requestAnimationFrame(this.loop);
  };

  private renderInspector(): void {
    const d = this.diagnosis;
    const a = this.analysis;
    const cp = this.normalized();
    $('#statVerts').textContent = String(cp.vertices.length);
    $('#statCreases').textContent = String(cp.creases.filter((c) => c.type !== 'border').length);
    $('#statFaces').textContent = a ? String(buildPlanarGraph(cp).faces.length) : '—';

    const badge = $('#theoremBadge');
    if (!d) return;
    if (d.allOk) {
      badge.className = 'badge ok';
      badge.textContent = '川崎/前川定理全部满足';
    } else {
      badge.className = 'badge err';
      badge.textContent = `${d.errorVertexIds.length} 个顶点不满足定理`;
    }

    const errBox = $('#errorList');
    errBox.innerHTML = '';
    d.vertices.filter((v) => !v.ok).forEach((v) => {
      const div = document.createElement('div');
      div.className = 'error-item';
      div.innerHTML = `<div class="title">顶点 #${v.vertexId}（${v.kind === 'interior' ? '内部' : '边界'}）</div>
        <div class="detail">${v.messages.join('；') || '拓扑结构异常'}</div>`;
      div.addEventListener('click', () => {
        this.editor.selectedVertex = v.vertexId;
        this.toast(`已定位顶点 #${v.vertexId}`);
      });
      errBox.appendChild(div);
    });

    const foldBadge = $('#foldBadge');
    const stuckBox = $('#stuckList');
    stuckBox.innerHTML = '';
    if (!a) {
      foldBadge.className = 'badge warn';
      foldBadge.textContent = '尚未分析';
      return;
    }
    if (a.foldable) {
      foldBadge.className = 'badge ok';
      const maxLayer = Math.max(1, ...a.layers.values());
      foldBadge.textContent = `可平折 · ${maxLayer} 层`;
    } else {
      foldBadge.className = 'badge err';
      foldBadge.textContent = '无法平折';
    }
    for (const cyc of a.stuckCycles) {
      const div = document.createElement('div');
      div.className = 'stuck-item';
      div.textContent = `互相卡住的面：${cyc.faceIds.map((f) => `#${f}`).join('、')}（涉及顶点 ${cyc.vertices.map((x) => `#${x}`).join('、')}）`;
      stuckBox.appendChild(div);
    }
    for (const rep of a.reports) {
      if (a.stuckCycles.length === 0 && a.localObstructions.length === 0) continue;
      const div = document.createElement('div');
      div.className = 'stuck-item';
      div.textContent = rep;
      stuckBox.appendChild(div);
    }
  }

  // ---------- 本地存储 ----------
  private refreshWorks(): void {
    const box = $('#workList');
    box.innerHTML = '';
    for (const w of listWorks()) {
      const div = document.createElement('div');
      div.className = 'work-item';
      div.innerHTML = `<div class="name">${w.name}</div>
        <div class="meta">${w.versions.length} 个版本 · ${new Date(w.updatedAt).toLocaleString('zh-CN')}</div>`;
      div.addEventListener('click', () => {
        const work = getWork(w.id)!;
        this.currentWork = work;
        this.editor.load(work.versions[work.versions.length - 1].cp);
        this.runAnalysis(false);
        ($('#workName') as HTMLInputElement).value = work.name;
        this.toast(`已打开作品「${work.name}」`);
      });
      box.appendChild(div);
    }
  }

  private saveNewWork(): void {
    const name = ($('#workName') as HTMLInputElement).value.trim() || '未命名作品';
    this.currentWork = createWork(name, this.normalized());
    this.refreshWorks();
    this.toast(`已创建作品「${name}」`);
  }

  private saveNewVersion(): void {
    if (!this.currentWork) {
      this.saveNewWork();
      return;
    }
    const note = ($('#versionNote') as HTMLInputElement).value || `版本 ${this.currentWork.versions.length + 1}`;
    this.currentWork = saveVersion(this.currentWork.id, this.normalized(), note);
    this.refreshWorks();
    this.toast('已保存新版本');
  }

  private renameCurrent(): void {
    if (!this.currentWork) return;
    const name = ($('#workName') as HTMLInputElement).value.trim() || this.currentWork.name;
    this.currentWork = renameWork(this.currentWork.id, name);
    this.refreshWorks();
  }

  private deleteCurrent(): void {
    if (!this.currentWork) return;
    if (!confirm(`确认删除作品「${this.currentWork.name}」及其全部版本？`)) return;
    deleteWork(this.currentWork.id);
    this.currentWork = null;
    this.refreshWorks();
    this.toast('作品已删除');
  }

  private exportJson(): void {
    const work = this.currentWork ?? createWork('导出作品', this.normalized());
    this.download(`${work.name}.json`, exportWorkJson(work), 'application/json');
  }

  private importJsonFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      this.currentWork = importWorkJson(text);
      this.editor.load(this.currentWork.versions.at(-1)!.cp);
      this.refreshWorks();
      this.runAnalysis(false);
      this.toast('作品已导入');
    });
    (e.target as HTMLInputElement).value = '';
  }

  // ---------- SVG 导出 ----------
  private exportSvg(): void {
    const cp = this.normalized();
    const svg = exportCreasePatternSvg(cp, {
      errorVertexIds: this.diagnosis?.errorVertexIds,
    });
    this.download('折痕图.svg', svg, 'image/svg+xml');
  }

  private exportLayer(): void {
    if (!this.analysis?.foldable) {
      this.toast('当前图案无法平折，无层序图可导出');
      return;
    }
    const cp = this.normalized();
    const graph = buildPlanarGraph(cp);
    this.download('层序图.svg', exportLayerSvg(graph, this.analysis), 'image/svg+xml');
  }

  private exportStepDiagrams(): void {
    if (!this.analysis?.foldable) {
      this.toast('当前图案无法平折，无折法步骤可导出');
      return;
    }
    const cp = this.normalized();
    const graph = buildPlanarGraph(cp);
    const steps = planFoldSteps(graph, this.analysis);
    const svgs = exportAllStepSvgs(cp, steps);
    svgs.forEach((svg, i) => {
      this.download(`折法步骤_${String(i + 1).padStart(2, '0')}.svg`, svg, 'image/svg+xml');
    });
    this.toast(`已导出 ${svgs.length} 张折法步骤图`);
  }

  private download(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private toast(msg: string): void {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    window.setTimeout(() => el.classList.remove('show'), 2200);
  }
}

new StudioApp();
