import { readOnly, recurring } from "./types.ts";
import type { Task } from "./types.ts";
import type { BoardTask } from "./boardModel.ts";

export interface TaskChain {
  parent: BoardTask;
  steps: BoardTask[];
}

function ordinaryTask(task: Task) {
  return (
    !task.missing &&
    !task.removed &&
    !task.deleteDate &&
    !task.journalDate &&
    !task.isNote &&
    !recurring(task)
  );
}

const rank = (task: Task) =>
  Number.isFinite(task.parentOrder) ? task.parentOrder! : 0;

export function taskChains(tasks: BoardTask[], marker: string): TaskChain[] {
  if (!marker) return [];
  const children = new Map<string, BoardTask[]>();
  const chains: TaskChain[] = [];
  for (const task of tasks.filter(ordinaryTask)) {
    if (task.parent) {
      const siblings = children.get(task.parent) || [];
      siblings.push(task);
      children.set(task.parent, siblings);
    } else if (!task.crypted && task.tags?.includes(marker)) {
      chains.push({ parent: task, steps: [] });
    }
  }
  for (const chain of chains) {
    chain.steps = (children.get(chain.parent.id) || []).sort(
      (a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }
  return chains.sort((a, b) =>
    a.parent.title.localeCompare(b.parent.title, "ru")
  );
}

export function canPositionStep(
  task: BoardTask,
  chain: TaskChain,
  marker: string
) {
  return (
    ordinaryTask(task) &&
    !readOnly(task) &&
    task.id !== chain.parent.id &&
    (task.parent
      ? task.parent === chain.parent.id
      : !task.tags?.includes(marker) &&
        (task.projectId || "") === (chain.parent.projectId || "") &&
        (task.group || "") === (chain.parent.group || ""))
  );
}
