import type {
  Layout,
  MatrixBounds,
  Scenario,
  ScenarioType,
  Settings,
  Tag,
} from "./types.ts";
import type { BoardTask } from "./boardModel.ts";

export const scenarioStyles = {
  goal: { color: "#29a66a", icon: "◎", label: "Цель", group: "Цели" },
  fear: { color: "#ef414b", icon: "!", label: "Опасение", group: "Опасения" },
  unclassified: {
    color: "#74808b",
    icon: "◇",
    label: "Без группы",
    group: "Без группы",
  },
};
export const scenarioType = (tag: Scenario): ScenarioType =>
  tag.scenarioType || "unclassified";
export const scenarioStyle = (tag: Scenario) =>
  scenarioStyles[scenarioType(tag)];
export const availableTag = (tag: Tag) =>
  !tag.missing && !tag.removed && !tag.deleteDate;

// Visibility depends only on tag availability, including tags with no tasks.
export function activeScenarios(scenarios: Scenario[]): Scenario[] {
  return scenarios.filter(availableTag);
}

export interface ScenarioLink {
  child: string;
  parent: string;
  type: "goal" | "fear";
}

export function scenarioTree(
  tags: Tag[],
  settings: Pick<Settings, "rootTagId" | "goalTagId" | "fearTagId">
): ScenarioLink[] {
  const activeTags = new Map(
    tags.filter(availableTag).map((tag) => [tag.id, tag])
  );
  if (!activeTags.has(settings.rootTagId)) return [];
  const children = new Map<string, Tag[]>();
  for (const tag of activeTags.values()) {
    if (!tag.parent) continue;
    const siblings = children.get(tag.parent) || [];
    siblings.push(tag);
    children.set(tag.parent, siblings);
  }
  const links: ScenarioLink[] = [];
  const seen = new Set([
    settings.rootTagId,
    settings.goalTagId,
    settings.fearTagId,
  ]);
  for (const type of ["goal", "fear"] as const) {
    const branchId = settings[type === "goal" ? "goalTagId" : "fearTagId"];
    if (activeTags.get(branchId)?.parent !== settings.rootTagId) continue;
    const next = [branchId];
    while (next.length) {
      const parent = next.pop()!;
      for (const child of children.get(parent) || []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        next.push(child.id);
        if (parent !== branchId) links.push({ child: child.id, parent, type });
      }
    }
  }
  return links;
}

export function scenarioBranch(
  links: Pick<ScenarioLink, "child" | "parent">[],
  root: string
) {
  const ids = new Set([root]);
  const children = new Map<string, string[]>();
  for (const { child, parent } of links) {
    const siblings = children.get(parent) || [];
    siblings.push(child);
    children.set(parent, siblings);
  }
  for (const id of ids) {
    for (const child of children.get(id) || []) ids.add(child);
  }
  return ids;
}

export function scenarioNodeIds(
  tagIds: ReadonlySet<string>,
  tasks: readonly Pick<BoardTask, "id" | "scenarioTags">[]
) {
  const ids = new Set(tagIds);
  for (const task of tasks) {
    if (task.scenarioTags.some((tag) => tagIds.has(tag))) ids.add(task.id);
  }
  return ids;
}

export function chainMarkerCandidates(tags: Tag[], root: string) {
  const scenarios = scenarioBranch(
    tags.flatMap((tag) =>
      tag.parent ? [{ child: tag.id, parent: tag.parent }] : []
    ),
    root
  );
  return tags.filter((tag) => availableTag(tag) && !scenarios.has(tag.id));
}

// The stored layout stays intact. Scenario positions follow growing matrix borders.
// Task layouts never participate in scenario classification or placement restrictions.
export function scenarioPositions(
  scenarios: Scenario[],
  layouts: Record<string, Layout>,
  matrix: MatrixBounds
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  const placed: { x: number; y: number }[] = [];
  for (const type of ["goal", "fear", "unclassified"] as const) {
    const group = scenarios.filter(
      (s) => scenarioType(s) === type && !layouts[s.id]?.hidden
    );
    // Respect manually positioned cards before assigning slots to new cards.
    const ordered = [...group].sort(
      (a, b) =>
        Number(layouts[b.id]?.x !== undefined) -
        Number(layouts[a.id]?.x !== undefined)
    );
    for (const tag of ordered) {
      const layout = layouts[tag.id] || {};
      const i = group.indexOf(tag);
      const position =
        type === "fear"
          ? {
              x: layout.x ?? matrix.left + 80 + i * 270,
              y: Math.max(layout.y ?? matrix.bottom + 130, matrix.bottom + 130),
            }
          : {
              x: Math.max(layout.x ?? matrix.right + 130, matrix.right + 130),
              y: layout.y ?? matrix.top + 110 + i * 150,
            };
      while (
        placed.some(
          (p) =>
            Math.abs(p.x - position.x) < 250 && Math.abs(p.y - position.y) < 124
        )
      ) {
        if (type === "fear") position.x += 270;
        else position.y += 150;
      }
      placed.push(position);
      result[tag.id] = position;
    }
  }
  return result;
}
