import type { Layout, Task } from "./types.ts";
import { recurring } from "./types.ts";

export interface BoardTask extends Task {
  layoutId: string;
  layout: Layout;
  occurrenceCount: number;
  scenarioTags: string[];
  canEditScenarios: boolean;
}
export const isPlaced = (layout: Layout | undefined): boolean =>
  Number.isFinite(layout?.x) && Number.isFinite(layout?.y);
export const taskLayoutId = (task: Task): string =>
  task.recurrenceGeneratorId || task.id;

// Group by API identity, never by title; the remote cache stays complete.
export function presentTasks(
  tasks: Task[],
  layouts: Record<string, Layout>
): BoardTask[] {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.missing || task.removed || task.deleteDate || task.isNote)
      continue;
    const key = taskLayoutId(task);
    const group = groups.get(key) || [];
    group.push(task);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([layoutId, members]) => {
    const sorted = [...members].sort((a, b) => {
      // Prefer the earliest open dated instance over the generator or completed history.
      const state = Number(!!a.checked) - Number(!!b.checked);
      if (state) return state;
      const generator = Number(a.id === layoutId) - Number(b.id === layoutId);
      if (generator) return generator;
      const dates = (a.start || "\uffff").localeCompare(b.start || "\uffff");
      return dates || a.id.localeCompare(b.id);
    });
    const task = sorted[0];
    const scenarioTask = recurring(task)
      ? members.find(
          (member) =>
            member.id === layoutId &&
            !member.recurrenceGeneratorId &&
            !member.journalDate &&
            recurring(member)
        )
      : task;
    // Keep previously placed/hidden occurrences when upgrading from separate cards.
    const legacy =
      sorted.find((t) => isPlaced(layouts[t.id])) ||
      sorted.find((t) => layouts[t.id]);
    const layout = {
      ...(legacy ? layouts[legacy.id] : {}),
      ...layouts[layoutId],
    };
    return {
      ...task,
      layoutId,
      layout,
      occurrenceCount: members.length,
      scenarioTags: (scenarioTask ?? task).tags ?? [],
      canEditScenarios:
        !!scenarioTask && !scenarioTask.crypted && !task.crypted,
    };
  });
}

export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}
export function horizontalWheelDelta(
  event: WheelInput,
  width: number,
  height: number
) {
  if (event.ctrlKey || event.metaKey) return null; // Leave pinch/zoom to React Flow.
  if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY))
    return null;
  const x = event.deltaX || (event.shiftKey ? event.deltaY : 0);
  const y = event.deltaX ? event.deltaY : 0;
  const unitX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
  const unitY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
  return x || y ? { x: x * unitX, y: y * unitY } : null;
}

// Place a task near the current viewport, keeping existing cards clear.
export function freePosition(
  center: { x: number; y: number },
  occupied: Layout[]
) {
  const start = { x: Math.round(center.x - 125), y: Math.round(center.y - 50) };
  const clear = (x: number, y: number) =>
    occupied.every(
      (l) =>
        !isPlaced(l) ||
        l.hidden ||
        x + 270 <= l.x! ||
        x >= l.x! + (l.width || 250) + 20 ||
        y + 120 <= l.y! ||
        y >= l.y! + (l.height || 100) + 20
    );
  for (let ring = 0; ring < 30; ring++) {
    for (let row = -ring; row <= ring; row++)
      for (let col = -ring; col <= ring; col++) {
        if (Math.max(Math.abs(row), Math.abs(col)) !== ring) continue;
        const x = start.x + col * 285,
          y = start.y + row * 135;
        if (clear(x, y)) return { x, y, width: 250, height: 100 };
      }
  }
  return { ...start, width: 250, height: 100 };
}
