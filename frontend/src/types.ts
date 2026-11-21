export type Raw = Record<string, any>;
export interface Task extends Raw {
  id: string;
  title: string;
  tags?: string[];
  checked?: number;
  note?: string;
  start?: string;
  deadline?: string;
  parent?: string;
  parentOrder?: number;
  projectId?: string;
  group?: string;
  missing?: boolean;
}
export interface Tag extends Raw {
  id: string;
  title: string;
  parent?: string;
  missing?: boolean;
}
export type ScenarioType = "goal" | "fear" | "unclassified";
export interface Scenario extends Tag {
  scenarioType: ScenarioType;
}
export interface Layout {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  hidden?: boolean;
}
export interface MatrixBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Settings {
  matrixBounds: MatrixBounds;
  rootTagId: string;
  goalTagId: string;
  fearTagId: string;
  scenarioHierarchy: boolean;
  chainTagId: string;
  timezone: string;
  syncSeconds: number;
  xAxis: string;
  yAxis: string;
  axisLabels: { left: string; right: string; top: string; bottom: string };
  quadrants: string[];
  projectIds: string[];
  viewport: { x: number; y: number; zoom: number };
}
export interface Operation {
  id: string;
  entityId: string;
  kind: string;
  status: string;
  attempts: number;
  detail: Raw;
  payload: Raw;
  createdAt: number;
  canLinkOnBoard?: boolean;
}
export interface TaskLink {
  source: string;
  target: string;
}
export interface Board {
  mode: "demo" | "real";
  settings: Settings;
  tasks: Task[];
  tags: Tag[];
  projects: Scenario[];
  nativeProjects: Tag[];
  layouts: Record<string, Layout>;
  taskLinks: TaskLink[];
  operations: Operation[];
  sync: { running: boolean; lastSuccess: number; error: string };
}
export const recurring = (task: Task) =>
  !!task.recurrenceGeneratorId ||
  (!!task.recurrence && Object.keys(task.recurrence).length > 0);
export const readOnly = (task: Task) =>
  recurring(task) ||
  !!task.crypted ||
  !!task.missing ||
  !!task.removed ||
  !!task.deleteDate;
export function noteText(note: string | undefined): string {
  if (!note) return "";
  try {
    const ops = JSON.parse(note);
    return Array.isArray(ops)
      ? ops
          .map((o) => (typeof o.insert === "string" ? o.insert : "[вложение]"))
          .join("")
          .trimEnd()
      : note;
  } catch {
    return note;
  }
}
export function simpleNote(note: string | undefined): boolean {
  if (!note) return true;
  try {
    const ops = JSON.parse(note);
    return (
      Array.isArray(ops) &&
      ops.every(
        (o) =>
          typeof o.insert === "string" &&
          Object.keys(o).every((k) => k === "insert")
      )
    );
  } catch {
    return false;
  }
}
export function taskLinkPath(source: string, target: string) {
  return `/task-links/${encodeURIComponent(source)}/${encodeURIComponent(
    target
  )}`;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Ошибка сервера (${response.status})`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
