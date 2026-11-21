import { api, readOnly, recurring } from "./types.ts";
import type { Task, TaskLink } from "./types.ts";
import type { BoardTask } from "./boardModel.ts";

export interface TaskChain {
  parent: BoardTask;
  // Singularity subtasks provide the positions for inserts and moves.
  steps: BoardTask[];
  displaySteps: BoardTask[];
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

export function taskChains(
  tasks: BoardTask[],
  marker: string,
  taskLinks: readonly TaskLink[] = []
): TaskChain[] {
  if (!marker) return [];
  const children = new Map<string, BoardTask[]>();
  const freeTasks = new Map<string, BoardTask>();
  const parents: BoardTask[] = [];
  for (const task of tasks.filter(ordinaryTask)) {
    if (task.parent) {
      const siblings = children.get(task.parent) || [];
      siblings.push(task);
      children.set(task.parent, siblings);
    } else if (!task.tags?.includes(marker)) {
      freeTasks.set(task.id, task);
    } else if (!task.crypted) {
      parents.push(task);
    }
  }
  const links = new Map<string, TaskLink[]>();
  for (const link of taskLinks) {
    for (const id of [link.source, link.target]) {
      const incident = links.get(id) || [];
      incident.push(link);
      links.set(id, incident);
    }
  }
  return parents
    .sort((a, b) => a.title.localeCompare(b.title, "ru"))
    .map((parent) => {
      const steps = (children.get(parent.id) || []).sort(
        (a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
      return {
        parent,
        steps,
        displaySteps: linkedChainSteps(steps, freeTasks, links),
      };
    });
}

function linkedChainSteps(
  steps: BoardTask[],
  freeTasks: ReadonlyMap<string, BoardTask>,
  links: ReadonlyMap<string, TaskLink[]>
): BoardTask[] {
  const members = new Map(steps.map((step) => [step.id, step]));
  for (const id of members.keys()) {
    for (const { source, target } of links.get(id) || []) {
      const neighbor = freeTasks.get(source === id ? target : source);
      if (neighbor) members.set(neighbor.id, neighbor);
    }
  }
  if (members.size === steps.length) return steps;

  const nativeNext = new Map(
    steps.slice(1).map((step, index) => [steps[index].id, step.id])
  );
  const successors = new Map<string, Set<string>>();
  const remaining = new Map(Array.from(members.keys(), (id) => [id, 0]));
  for (const id of members.keys()) {
    const targets = new Set(
      (links.get(id) || []).flatMap(({ source, target }) =>
        source === id && members.has(target) ? [target] : []
      )
    );
    const next = nativeNext.get(id);
    if (next) targets.add(next);
    successors.set(id, targets);
    for (const target of targets)
      remaining.set(target, remaining.get(target)! + 1);
  }

  const ready = Array.from(members.values())
    .filter(({ id }) => remaining.get(id) === 0)
    .sort(
      (a, b) => a.title.localeCompare(b.title, "ru") || a.id.localeCompare(b.id)
    )
    .map(({ id }) => id);
  const ordered: BoardTask[] = [];
  let nextReady = 0;
  while (remaining.size) {
    // Break a cyclic set of arrows in insertion order, which starts with native order.
    const id =
      nextReady < ready.length
        ? ready[nextReady++]
        : remaining.keys().next().value!;
    ordered.push(members.get(id)!);
    remaining.delete(id);
    for (const target of successors.get(id)!) {
      const count = remaining.get(target);
      if (count === undefined) continue;
      remaining.set(target, count - 1);
      if (count === 1) ready.push(target);
    }
  }
  return ordered;
}

export function canPositionStep(
  task: BoardTask,
  chain: TaskChain,
  marker: string
) {
  return (
    canLinkChainStep(task, marker) &&
    task.id !== chain.parent.id &&
    (task.parent
      ? task.parent === chain.parent.id
      : !!chain.parent.projectId && sameTaskLocation(task, chain.parent))
  );
}

export function canLinkChainStep(task: Task, marker: string) {
  return (
    ordinaryTask(task) &&
    !readOnly(task) &&
    (!!task.parent || !task.tags?.includes(marker))
  );
}

export function sameTaskLocation(a: Task, b: Task) {
  return (
    (a.projectId || "") === (b.projectId || "") &&
    (a.group || "") === (b.group || "")
  );
}

export function moveChainStep(chainId: string, step: Task, afterId: string) {
  return api<{ operationId: string }>(
    `/chains/${encodeURIComponent(chainId)}/steps/${encodeURIComponent(
      step.id
    )}`,
    "PATCH",
    {
      afterId,
      base: {
        parent: step.parent ?? null,
        parentOrder: step.parentOrder ?? null,
      },
    }
  );
}
