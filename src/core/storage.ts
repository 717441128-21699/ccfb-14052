import type { CreasePattern } from './types';

/**
 * 作品与版本的本地存储（localStorage，纯 JSON，无后端）。
 * 一个作品包含多个版本，每次保存生成不可变版本快照。
 */

export interface PatternVersion {
  id: string;
  createdAt: number;
  note: string;
  cp: CreasePattern;
}

export interface Work {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  versions: PatternVersion[];
}

const PREFIX = 'origami-studio:work:';
const INDEX_KEY = 'origami-studio:index';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rid(): string {
  // crypto.randomUUID 在现代浏览器与 Node 19+ 均可用
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function listWorks(): Work[] {
  const ids = safeParse<string[]>(localStorage.getItem(INDEX_KEY), []);
  const works: Work[] = [];
  for (const id of ids) {
    const w = safeParse<Work | null>(localStorage.getItem(PREFIX + id), null);
    if (w) works.push(w);
  }
  works.sort((a, b) => b.updatedAt - a.updatedAt);
  return works;
}

export function getWork(id: string): Work | null {
  return safeParse<Work | null>(localStorage.getItem(PREFIX + id), null);
}

export function createWork(name: string, cp: CreasePattern, note = '初始版本'): Work {
  const now = Date.now();
  const work: Work = {
    id: rid(),
    name: name || '未命名作品',
    createdAt: now,
    updatedAt: now,
    versions: [{ id: rid(), createdAt: now, note, cp: structuredClone(cp) }],
  };
  persist(work);
  return work;
}

/** 在已有作品上保存新版本，返回更新后的作品 */
export function saveVersion(
  workId: string,
  cp: CreasePattern,
  note: string,
): Work {
  const work = getWork(workId);
  if (!work) throw new Error(`作品 ${workId} 不存在`);
  work.versions.push({
    id: rid(),
    createdAt: Date.now(),
    note: note || `版本 ${work.versions.length + 1}`,
    cp: structuredClone(cp),
  });
  work.updatedAt = Date.now();
  persist(work);
  return work;
}

export function renameWork(workId: string, name: string): Work | null {
  const work = getWork(workId);
  if (!work) return null;
  work.name = name;
  work.updatedAt = Date.now();
  persist(work);
  return work;
}

export function deleteWork(workId: string): void {
  localStorage.removeItem(PREFIX + workId);
  const ids = safeParse<string[]>(localStorage.getItem(INDEX_KEY), []);
  localStorage.setItem(INDEX_KEY, JSON.stringify(ids.filter((id) => id !== workId)));
}

export function exportWorkJson(work: Work): string {
  return JSON.stringify(work, null, 2);
}

export function importWorkJson(json: string): Work {
  const work = JSON.parse(json) as Work;
  if (!work.id || !Array.isArray(work.versions)) {
    throw new Error('文件不是有效的作品 JSON');
  }
  persist(work);
  return work;
}

function persist(work: Work): void {
  try {
    localStorage.setItem(PREFIX + work.id, JSON.stringify(work));
    const ids = safeParse<string[]>(localStorage.getItem(INDEX_KEY), []);
    if (!ids.includes(work.id)) {
      ids.push(work.id);
      localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
    }
  } catch (err) {
    throw new Error(
      `本地存储失败（可能超出浏览器容量）：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
