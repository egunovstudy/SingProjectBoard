import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  ControlButton,
  Edge,
  Node,
  ReactFlowInstance,
  ReactFlowProvider,
  applyNodeChanges,
} from "reactflow";
import { api, Board, Layout, Settings, Scenario, Task } from "./types";
import { icon } from "./ui";
import { nodeTypes } from "./BoardNodes";
import {
  scenarioPositions,
  scenarioStyle,
  scenarioType,
  scenarioStyles,
  activeScenarios,
  chainMarkerCandidates,
  scenarioBranch,
  scenarioNodeIds,
  scenarioTree,
} from "./scenarios";
import { taskChains } from "./chains";
import { ChainPanel, CreateChainPanel } from "./ChainPanel";
import ScenarioParentPanel from "./ScenarioParentPanel";
import TaskEditor from "./TaskEditor";
import TaskTray, { TASK_DRAG_TYPE } from "./TaskTray";
import type { TaskTrayMode } from "./TaskTray";
import {
  presentTasks,
  taskLayoutId,
  isPlaced,
  horizontalWheelDelta,
  freePosition,
} from "./boardModel";
import {
  DEFAULT_MATRIX,
  expandMatrix,
  fitMatrix,
  matrixFrame,
  placeInQuadrant,
  quadrantRect,
  resizeMatrix,
  sameMatrix,
  validMatrix,
} from "./matrixGeometry";
import type { MatrixSide } from "./matrixGeometry";
import type { MatrixBounds } from "./types";
import type { BoardTask } from "./boardModel";
import SettingsDialog from "./SettingsDialog";
import OperationsDialog from "./OperationsDialog";

function taskScenarioLabel(scenario: Scenario) {
  return `Для ${scenario.scenarioType === "goal" ? "цели" : "опасения"} «${
    scenario.title
  }»`;
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}
function Workspace() {
  const [board, setBoard] = useState<Board>();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [project, setProject] = useState("");
  const [onlyProject, setOnlyProject] = useState(false);
  const [scenariosOnly, setScenariosOnly] = useState(false);
  const [chainId, setChainId] = useState("");
  const [relationPanel, setRelationPanel] = useState<
    "new-chain" | "chain" | "scenario" | null
  >(null);
  const createRequests = useRef<Record<string, string>>({});
  function createRequest(key: string) {
    return (createRequests.current[key] ||= crypto.randomUUID());
  }
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [trayMode, setTrayMode] = useState<TaskTrayMode | null>(null);
  const inbox = trayMode === "inbox";
  const hidden = trayMode === "hidden";
  const [layoutRevision, setLayoutRevision] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState<"board" | "chains" | null>(
    null
  );
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [quick, setQuick] = useState("");
  const [creating, setCreating] = useState(false);
  const paneClickScenario = useRef<Scenario>();
  const [newProject, setNewProject] = useState("");
  const [newScenarioType, setNewScenarioType] = useState<"goal" | "fear">(
    "goal"
  );
  const scenarioRequestBusy = useRef(false);
  const scenarioInput = useRef<HTMLInputElement>(null);
  const [creatingScenario, setCreatingScenario] = useState(false);
  const [scenarioError, setScenarioError] = useState("");
  const [scenarioMessage, setScenarioMessage] = useState("");
  const [edgeId, setEdgeId] = useState("");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [flow, setFlow] = useState<ReactFlowInstance>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [offline, setOffline] = useState(false);
  const draftLayouts = useRef<Record<string, Layout>>({});
  const matrixDraft = useRef<MatrixBounds>();
  const [matrixRevision, setMatrixRevision] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const viewportTimer = useRef<ReturnType<typeof setTimeout>>();
  const viewportDraft = useRef<Settings["viewport"]>();
  const loaded = useRef(false);
  const refreshBusy = useRef(false);
  const boardRef = useRef<Board>();
  const refresh = useCallback(async () => {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    try {
      const next = await api<Board>("/board");
      boardRef.current = next;
      setBoard(next);
      setOffline(false);
    } catch (e) {
      setOffline(true);
      if (!boardRef.current) setError((e as Error).message);
    } finally {
      refreshBusy.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      clearTimeout(viewportTimer.current);
    },
    []
  );
  async function act(action: () => Promise<unknown>) {
    try {
      setError("");
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function flushLayouts() {
    const pending = { ...draftLayouts.current };
    const viewport = viewportDraft.current;
    const matrixBounds = matrixDraft.current;
    setSaving(true);
    try {
      for (const [id, value] of Object.entries(pending)) {
        await api(`/layouts/${encodeURIComponent(id)}`, "PUT", value);
        if (draftLayouts.current[id] === value) delete draftLayouts.current[id];
      }
      if (matrixBounds) {
        await api("/settings", "PATCH", { matrixBounds });
        if (matrixDraft.current === matrixBounds) {
          matrixDraft.current = undefined;
          localStorage.removeItem(
            "singboard:matrix-draft:" + boardRef.current?.mode
          );
        }
      }
      if (viewport) {
        await api("/settings", "PATCH", { viewport });
        if (viewportDraft.current === viewport)
          viewportDraft.current = undefined;
      }
      setSaveError("");
      if (
        Object.keys(draftLayouts.current).length === 0 &&
        !viewportDraft.current
      ) {
        localStorage.removeItem(
          "singboard:layout-drafts:" + boardRef.current?.mode
        );
      }
      await refresh();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const queueMatrix = useCallback(
    (bounds: MatrixBounds) => {
      const current =
        matrixDraft.current ||
        boardRef.current?.settings.matrixBounds ||
        DEFAULT_MATRIX;
      if (sameMatrix(current, bounds)) return;
      matrixDraft.current = bounds;
      setMatrixRevision((n) => n + 1);
      localStorage.setItem(
        "singboard:matrix-draft:" + boardRef.current?.mode,
        JSON.stringify(bounds)
      );
      setSaving(true);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushLayouts(), 450);
    },
    [refresh]
  );
  const saveLayout = useCallback(
    (id: string, value: Layout) => {
      const task = boardRef.current?.tasks.find((t) => t.id === id);
      const layoutId = task ? taskLayoutId(task) : id;
      const rawLayouts = {
        ...boardRef.current?.layouts,
        ...draftLayouts.current,
      };
      const existing = task
        ? presentTasks(boardRef.current!.tasks, rawLayouts).find(
            (t) => t.layoutId === layoutId
          )?.layout
        : rawLayouts[id];
      draftLayouts.current[layoutId] = { ...existing, ...value };
      const updated = presentTasks(boardRef.current?.tasks || [], {
        ...boardRef.current?.layouts,
        ...draftLayouts.current,
      });
      queueMatrix(
        expandMatrix(
          matrixDraft.current ||
            boardRef.current?.settings.matrixBounds ||
            DEFAULT_MATRIX,
          updated.map((t) => t.layout)
        )
      );
      setLayoutRevision((n) => n + 1);
      localStorage.setItem(
        "singboard:layout-drafts:" + boardRef.current?.mode,
        JSON.stringify(draftLayouts.current)
      );
      setSaving(true);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushLayouts(), 450);
    },
    [refresh, queueMatrix]
  );
  useEffect(() => {
    if (board && !loaded.current) {
      loaded.current = true;
      try {
        draftLayouts.current = JSON.parse(
          localStorage.getItem("singboard:layout-drafts:" + board.mode) || "{}"
        );
      } catch {
        draftLayouts.current = {};
      }
      try {
        const restored = JSON.parse(
          localStorage.getItem("singboard:matrix-draft:" + board.mode) || "null"
        );
        if (validMatrix(restored)) {
          matrixDraft.current = restored;
          setMatrixRevision((n) => n + 1);
        }
      } catch {
        /* The saved server dimensions remain available. */
      }
      if (Object.keys(draftLayouts.current).length || matrixDraft.current) {
        setLayoutRevision((n) => n + 1);
        setSaveError(
          "Осталась несохранённая раскладка. Нажмите «Повторить сохранение»."
        );
      }
    }
  }, [board]);
  const complete = useCallback(
    (t: Task) =>
      void act(() =>
        api(`/tasks/${encodeURIComponent(t.id)}`, "PATCH", {
          base: { checked: t.checked ?? 0 },
          changes: { checked: t.checked ? 0 : 1 },
        })
      ),
    [refresh]
  );
  useEffect(() => {
    const element = surface.current;
    if (!element || !flow) return;
    const wheel = (event: WheelEvent) => {
      const delta = horizontalWheelDelta(
        event,
        element.clientWidth,
        element.clientHeight
      );
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      const v = flow.getViewport();
      void flow.setViewport({ ...v, x: v.x - delta.x, y: v.y - delta.y });
    };
    element.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => element.removeEventListener("wheel", wheel, true);
  }, [flow]);
  const views = useMemo(
    () =>
      presentTasks(board?.tasks || [], {
        ...board?.layouts,
        ...draftLayouts.current,
      }),
    [board, layoutRevision]
  );
  const matrix = useMemo(
    () =>
      expandMatrix(
        matrixDraft.current || board?.settings.matrixBounds || DEFAULT_MATRIX,
        views.map((t) => t.layout)
      ),
    [board, views, matrixRevision]
  );
  useEffect(() => {
    if (!board || !loaded.current) return;
    const base =
      matrixDraft.current || board.settings.matrixBounds || DEFAULT_MATRIX;
    queueMatrix(
      expandMatrix(
        base,
        views.map((t) => t.layout)
      )
    );
  }, [board, views, queueMatrix]);
  function growDuringDrag(node: Node) {
    if (node.type !== "task") return;
    const items = presentTasks(boardRef.current?.tasks || [], {
      ...boardRef.current?.layouts,
      ...draftLayouts.current,
    });
    const occupied = items.map((t) =>
      t.id === node.id
        ? {
            ...t.layout,
            ...node.position,
            width: node.width || 250,
            height: node.height || 100,
          }
        : t.layout
    );
    queueMatrix(
      expandMatrix(
        matrixDraft.current ||
          boardRef.current?.settings.matrixBounds ||
          DEFAULT_MATRIX,
        occupied
      )
    );
  }
  const resizeBoundary = (side: MatrixSide, value: number) =>
    queueMatrix(
      resizeMatrix(
        matrix,
        side,
        value,
        views.map((t) => t.layout)
      )
    );
  const focusQuadrant = (index: number) =>
    void flow?.fitBounds(quadrantRect(matrix, index), {
      padding: 0.12,
      duration: 300,
    });
  const projects = useMemo(
    () => activeScenarios(board?.projects || []),
    [board]
  );
  const activeScenario = projects.find((p) => p.id === project);
  const taskScenario =
    activeScenario?.scenarioType === "goal" ||
    activeScenario?.scenarioType === "fear"
      ? activeScenario
      : undefined;
  const tree = useMemo(
    () =>
      board?.settings.scenarioHierarchy
        ? scenarioTree(board.tags, board.settings)
        : [],
    [board]
  );
  const scenarioFocus = useMemo(
    () => (activeScenario ? scenarioBranch(tree, project) : new Set<string>()),
    [tree, project, activeScenario]
  );
  const scenarioNodes = useMemo(
    () =>
      activeScenario ? scenarioNodeIds(scenarioFocus, views) : scenarioFocus,
    [activeScenario, scenarioFocus, views]
  );
  const chainMarker = useMemo(
    () =>
      board &&
      chainMarkerCandidates(board.tags, board.settings.rootTagId).find(
        (tag) => tag.id === board.settings.chainTagId
      ),
    [board]
  );
  const chains = useMemo(
    () =>
      taskChains(views, chainMarker?.id || "").filter(
        ({ parent }) =>
          !board?.settings.projectIds.length ||
          board.settings.projectIds.includes(parent.projectId || "")
      ),
    [views, chainMarker, board]
  );
  const activeChain = chains.find(({ parent }) => parent.id === chainId);
  const focusedSteps = useMemo(
    () => new Set(activeChain?.steps.map((step) => step.id)),
    [activeChain]
  );
  const groupNodes = activeChain ? focusedSteps : scenarioNodes;
  const nextStepId = activeChain?.steps.find((step) => !step.checked)?.id;
  useEffect(() => {
    if (project && !activeScenario) {
      setProject("");
      if (relationPanel === "scenario") setRelationPanel(null);
    }
    if (chainId && !activeChain) {
      setChainId("");
      if (relationPanel === "chain") setRelationPanel(null);
    }
  }, [activeScenario, project, chainId, activeChain, relationPanel]);
  const filtered = useMemo(
    () =>
      views.filter(
        (t) =>
          !t.missing &&
          !t.removed &&
          !t.deleteDate &&
          !t.isNote &&
          (showDone || !t.checked || focusedSteps.has(t.id)) &&
          (!onlyProject || !activeScenario || scenarioNodes.has(t.id)) &&
          t.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
          (!board?.settings.projectIds.length ||
            board.settings.projectIds.includes(t.projectId || ""))
      ) || [],
    [
      board,
      views,
      showDone,
      search,
      activeScenario,
      onlyProject,
      scenarioNodes,
      focusedSteps,
    ]
  );
  const layouts = useMemo(
    () => ({
      ...board?.layouts,
      ...draftLayouts.current,
      ...Object.fromEntries(views.map((t) => [t.id, t.layout])),
    }),
    [board, views, layoutRevision]
  );
  const visible = useMemo(
    () =>
      scenariosOnly
        ? []
        : filtered.filter((t) => !t.layout.hidden && isPlaced(t.layout)),
    [scenariosOnly, filtered]
  );
  const listTasks = filtered.filter(
    (t) =>
      trayMode === "all" ||
      (hidden ? t.layout.hidden : !isPlaced(t.layout) && !t.layout.hidden)
  );
  function clearGroup() {
    setProject("");
    setChainId("");
    setRelationPanel((panel) => (panel === "new-chain" ? panel : null));
  }
  function clearSelection() {
    clearGroup();
    setOnlyProject(false);
    setSelected("");
    setEdgeId("");
    setNodes((current) =>
      current.map((node) =>
        node.selected ? { ...node, selected: false } : node
      )
    );
  }
  function selectTask(id: string) {
    if (!groupNodes.has(id)) clearGroup();
    setSelected(views.find((t) => t.id === id)?.layoutId ?? id);
    setEdgeId("");
  }
  function selectEdge(edge: Edge) {
    if (!groupNodes.has(edge.source) || !groupNodes.has(edge.target))
      clearGroup();
    setSelected("");
    setEdgeId(edge.id);
  }
  function selectScenario(id: string) {
    setProject(project === id ? "" : id);
    setChainId("");
    setRelationPanel(null);
    setTrayMode(null);
    setSelected("");
    setEdgeId("");
  }
  const openChain = useCallback((id: string) => {
    setChainId(id);
    setProject("");
    setSearch("");
    setScenariosOnly(false);
    setRelationPanel("chain");
    setTrayMode(null);
    setSelected("");
    setEdgeId("");
  }, []);
  function startChain() {
    if (!chainMarker) {
      setSettingsOpen("chains");
      return;
    }
    setChainId("");
    setTrayMode(null);
    setSelected("");
    setEdgeId("");
    setRelationPanel("new-chain");
  }
  function openTray(mode: TaskTrayMode | null) {
    setRelationPanel(null);
    setChainId("");
    setTrayMode(mode);
    setScenariosOnly(false);
  }
  function placeTask(task: BoardTask, quadrant?: number) {
    if (task.layout.hidden && isPlaced(task.layout))
      saveLayout(task.id, { hidden: false });
    else {
      if (quadrant !== undefined) {
        try {
          saveLayout(task.id, {
            ...placeInQuadrant(
              quadrant,
              matrix,
              views.map((t) => t.layout),
              {
                width: task.layout.width || 250,
                height: task.layout.height || 100,
              }
            ),
            hidden: false,
          });
          setError("");
        } catch (e) {
          setError((e as Error).message);
        }
        return;
      }
      const rect = surface.current?.getBoundingClientRect();
      const center =
        flow && rect
          ? flow.screenToFlowPosition({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            })
          : { x: 350, y: 300 };
      saveLayout(task.id, {
        ...freePosition(
          center,
          views.map((t) => t.layout)
        ),
        hidden: false,
      });
    }
  }
  function showBoard() {
    clearSelection();
    void flow?.fitView({ padding: 0.12, duration: 300 });
  }
  function jumpToTask(task: BoardTask) {
    setTrayMode(null);
    setRelationPanel(null);
    void flow?.setCenter(
      task.layout.x! + (task.layout.width || 250) / 2,
      task.layout.y! + (task.layout.height || 100) / 2,
      { zoom: 1, duration: 300 }
    );
  }
  const projectMap = useMemo(
    () =>
      new Map(
        projects.map((p) => [p.id, { ...p, color: scenarioStyle(p).color }])
      ),
    [projects]
  );
  useEffect(() => {
    if (!board) return;
    const next: Node[] = [
      {
        id: "matrix",
        type: "matrix",
        data: {
          settings: board.settings,
          bounds: matrix,
          resize: resizeBoundary,
          focus: focusQuadrant,
          getZoom: () => flow?.getViewport().zoom || 1,
        },
        position: matrixFrame(matrix).position,
        draggable: false,
        selectable: false,
        connectable: false,
        zIndex: -10,
        style: {
          width: matrixFrame(matrix).width,
          height: matrixFrame(matrix).height,
        },
      },
    ];
    visible.forEach((task) => {
      const layout = task.layout;
      const taskProjects = task.scenarioTags
        .map((id) => projectMap.get(id))
        .filter(Boolean) as (Scenario & { color: string })[];
      next.push({
        id: task.id,
        type: "task",
        data: {
          task,
          color: taskProjects[0]?.color || "#bdc4c9",
          projectNames: taskProjects.map((p) => p.title),
          nextStep: task.id === nextStepId,
          save: saveLayout,
          complete,
        },
        position: {
          x: layout.x!,
          y: layout.y!,
        },
        selected: task.layoutId === selected,
        style: {
          width: layout.width || 250,
          height: layout.height || 100,
        },
        zIndex: 2,
      });
    });
    const positions = scenarioPositions(projects, layouts, matrix);
    projects
      .filter(
        (p) =>
          !layouts[p.id]?.hidden &&
          (!scenariosOnly || p.scenarioType !== "unclassified")
      )
      .forEach((tag) => {
        next.push({
          id: tag.id,
          type: "project",
          data: {
            tag,
            color: scenarioStyle(tag).color,
            count: filtered.filter((t) => t.scenarioTags.includes(tag.id))
              .length,
          },
          position: positions[tag.id],
          style: {
            width: 230,
            height: 104,
          },
          selected: project === tag.id,
        });
      });
    // Preserve positions of any node currently being dragged between poll responses.
    setNodes((old) =>
      next.map((n) => {
        const previous = old.find((o) => o.id === n.id);
        return previous?.dragging
          ? { ...n, position: previous.position, dragging: true }
          : n;
      })
    );
  }, [
    board,
    layouts,
    matrix,
    flow,
    project,
    nextStepId,
    visible,
    scenariosOnly,
    filtered,
    projects,
    projectMap,
    selected,
    saveLayout,
    complete,
  ]);
  const motivationEdges: Edge[] = visible.flatMap((t) =>
    t.scenarioTags
      .filter((tag) => projectMap.has(tag) && !layouts[tag]?.hidden)
      .map((tag) => ({
        id: `${t.id}:${tag}`,
        source: t.id,
        target: tag,
        sourceHandle: "task",
        targetHandle: "project",
        type: "smoothstep",
        className: `scenario-link ${scenarioType(projectMap.get(tag)!)}`,
        markerEnd:
          scenarioType(projectMap.get(tag)!) === "goal"
            ? "scenario-goal-arrow"
            : scenarioType(projectMap.get(tag)!) === "fear"
            ? "scenario-fear-dot"
            : undefined,
        ariaLabel: `${t.title}: ${
          scenarioType(projectMap.get(tag)!) === "fear"
            ? "помогает предотвратить"
            : "помогает достичь"
        } — ${projectMap.get(tag)?.title}`,
        style: {
          stroke: projectMap.get(tag)?.color || "#aaa",
          strokeWidth: scenarioFocus.has(tag) ? 2.5 : 1.8,
        },
      }))
  );
  const treeEdges: Edge[] = tree
    .filter(
      ({ child, parent }) =>
        projectMap.has(child) &&
        projectMap.has(parent) &&
        !layouts[child]?.hidden &&
        !layouts[parent]?.hidden
    )
    .map(({ child, parent, type }) => ({
      id: `scenario:${child}:${parent}`,
      source: child,
      target: parent,
      sourceHandle: "scenario-child",
      targetHandle: "scenario-parent",
      type: "smoothstep",
      data: { kind: "tree" },
      markerEnd:
        type === "goal" ? "scenario-goal-arrow" : "scenario-fear-arrow",
      ariaLabel: `${projectMap.get(child)?.title} → ${
        projectMap.get(parent)?.title
      }`,
      style: {
        stroke: scenarioStyles[type].color,
        strokeWidth: 2.4,
        strokeDasharray: "6 4",
      },
    }));
  const visibleTaskIds = new Set(visible.map((t) => t.id));
  const chainEdges: Edge[] = chains.flatMap(({ parent, steps }) => {
    const focused = chainId === parent.id;
    return steps.slice(1).flatMap((step, index) => {
      const previous = steps[index];
      if (!visibleTaskIds.has(previous.id) || !visibleTaskIds.has(step.id))
        return [];
      return [
        {
          id: `chain:${previous.id}:${step.id}`,
          source: previous.id,
          target: step.id,
          sourceHandle: "task",
          targetHandle: "chain-step",
          type: "smoothstep",
          data: { kind: "chain", chainId: parent.id },
          markerEnd: "chain-arrow",
          label: focused ? index + 2 : undefined,
          labelStyle: { fill: "#285eab", fontWeight: 700 },
          ariaLabel: `${previous.title} → ${step.title}`,
          style: {
            stroke: "#386fc3",
            strokeWidth: focused ? 3 : 2.2,
          },
        },
      ];
    });
  });
  const boardEdges = [...motivationEdges, ...treeEdges, ...chainEdges];
  const edge = boardEdges.find((candidate) => candidate.id === edgeId);
  const edgeSource = edge?.source;
  const edgeTarget = edge?.target;
  const highlightedNodes = useMemo(() => {
    const ids = new Set(groupNodes);
    const selectedTags = new Set<string>();
    for (const node of nodes) {
      if (!node.selected) continue;
      ids.add(node.id);
      if (node.type === "project" && !scenarioFocus.has(node.id)) {
        for (const tag of scenarioBranch(tree, node.id)) selectedTags.add(tag);
      }
    }
    if (selectedTags.size) {
      for (const id of scenarioNodeIds(selectedTags, visible)) ids.add(id);
    }
    if (edgeSource && edgeTarget) {
      ids.add(edgeSource);
      ids.add(edgeTarget);
    }
    return ids;
  }, [groupNodes, nodes, scenarioFocus, tree, visible, edgeSource, edgeTarget]);
  const hasHighlight = nodes.some((node) => highlightedNodes.has(node.id));
  const displayedNodes = useMemo(
    () =>
      hasHighlight
        ? nodes.map((node) =>
            node.type === "matrix" || highlightedNodes.has(node.id)
              ? node
              : { ...node, className: "dimmed" }
          )
        : nodes,
    [nodes, hasHighlight, highlightedNodes]
  );
  const edges = boardEdges.map((link) => ({
    ...link,
    selected: link.id === edgeId,
    className:
      hasHighlight &&
      (!highlightedNodes.has(link.source) || !highlightedNodes.has(link.target))
        ? `${link.className || ""} dimmed`.trim()
        : link.className,
  }));
  useEffect(() => {
    if (!edge && edgeId) setEdgeId("");
  }, [edge, edgeId]);
  async function connect(c: Connection) {
    if (c.source && c.target)
      await act(() =>
        api(`/tasks/${encodeURIComponent(c.source!)}/tags`, "POST", {
          tagId: c.target,
          add: true,
        })
      );
  }
  async function createTask(
    title: string,
    scenarioId?: string,
    position?: { x: number; y: number }
  ) {
    const key = JSON.stringify(["task", title, scenarioId, position]);
    await api("/tasks", "POST", {
      title,
      requestId: createRequest(key),
      scenarioId,
      position,
    });
    delete createRequests.current[key];
  }
  async function createQuickTask() {
    const title = quick.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      await act(async () => {
        await createTask(title, taskScenario?.id);
        setQuick((current) => (current === quick ? "" : current));
      });
    } finally {
      setCreating(false);
    }
  }
  const queue =
    board?.operations.filter(
      (o) => !["DONE", "CANCELLED"].includes(o.status)
    ) || [];
  const problematic = queue.filter((o) =>
    ["ERROR", "CONFLICT", "UNCERTAIN"].includes(o.status)
  );
  const selectedView = views.find((t) => t.layoutId === selected);
  const task = selectedView ?? board?.tasks.find((t) => t.id === selected);
  useEffect(() => {
    if (board && selected && !task) setSelected("");
  }, [board, selected, task]);
  const scenarioForEditing =
    board?.settings.scenarioHierarchy && projectMap.get(project);
  const scenarioCreationBranch = board?.tags.find(
    (tag) => tag.id === board.settings[`${newScenarioType}TagId`]
  );
  const scenarioSetupHint = !board?.settings.rootTagId
    ? "Выберите корневой тег в настройках."
    : !scenarioCreationBranch ||
      scenarioCreationBranch.missing ||
      scenarioCreationBranch.removed ||
      scenarioCreationBranch.deleteDate
    ? `Выберите или создайте ветку «${scenarioStyles[newScenarioType].group}» в настройках.`
    : scenarioCreationBranch.parent !== board.settings.rootTagId
    ? "Ветка перемещена из корня. Проверьте настройки."
    : "";
  async function createScenario() {
    const title = newProject.trim();
    if (!title || scenarioSetupHint || scenarioRequestBusy.current) return;
    scenarioRequestBusy.current = true;
    setCreatingScenario(true);
    setScenarioError("");
    setScenarioMessage("");
    const key = `tag:${scenarioCreationBranch!.id}:${newScenarioType}:${title}`;
    try {
      await api("/tags", "POST", {
        title,
        scenarioType: newScenarioType,
        requestId: createRequest(key),
      });
      delete createRequests.current[key];
      setNewProject("");
      setScenarioMessage(
        "Создание в очереди. Карточка появится после отправки."
      );
      await refresh();
    } catch (e) {
      setScenarioError((e as Error).message);
    } finally {
      scenarioRequestBusy.current = false;
      setCreatingScenario(false);
      requestAnimationFrame(() => scenarioInput.current?.focus());
    }
  }
  if (!board)
    return (
      <div className="loading">
        <div className="orbit-logo">◉</div>
        <h1>Орбита</h1>
        <p>{error || "Открываем вашу доску…"}</p>
        {error && <button onClick={() => void refresh()}>Повторить</button>}
      </div>
    );
  return (
    <div className="workspace">
      <header className="header">
        <div className="brand">
          <div className="orbit-logo">◉</div>
          <div>
            <strong>
              Орбита<span> / </span>
              <small>Singularity</small>
            </strong>
            <p>Место для ясных планов</p>
          </div>
        </div>
        <div className="header-right">
          <span className={`mode ${board.mode}`}>
            {board.mode === "demo"
              ? "ДЕМО · локальные данные"
              : "SINGULARITY · реальный аккаунт"}
          </span>
          <button
            className={`icon-button ${queue.length ? "has-queue" : ""}`}
            title="Операции синхронизации"
            aria-label="Операции синхронизации"
            onClick={() => setOperationsOpen(true)}
          >
            {icon("sync")}
            {queue.length > 0 && <b>{queue.length}</b>}
          </button>
          <button
            className="icon-button"
            title="Настройки"
            aria-label="Настройки"
            onClick={() => setSettingsOpen("board")}
          >
            {icon("settings")}
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <div className="side-heading">МОЯ ДОСКА</div>
        <button
          className={`side-item ${
            !inbox && !hidden && !project && !chainId && !scenariosOnly
              ? "active"
              : ""
          }`}
          onClick={() => {
            setProject("");
            openTray("all");
            setSearch("");
          }}
        >
          {icon("grid")}
          <span>Все задачи</span>
          <b>{filtered.length}</b>
        </button>
        <button
          className={`side-item ${inbox ? "active" : ""}`}
          onClick={() => {
            openTray(inbox ? null : "inbox");
            setProject("");
          }}
        >
          {icon("inbox")}
          <span>Неразобранное</span>
          <b>
            {
              filtered.filter((t) => !isPlaced(t.layout) && !t.layout.hidden)
                .length
            }
          </b>
        </button>
        <section className="side-section chain-nav" aria-label="Цепочки задач">
          <div className="side-heading">ЦЕПОЧКИ</div>
          {chains.map(({ parent, steps }) => (
            <button
              key={parent.id}
              className={`side-item ${chainId === parent.id ? "active" : ""}`}
              aria-pressed={chainId === parent.id}
              onClick={() => openChain(parent.id)}
            >
              {icon("link", 16)}
              <span>{parent.title}</span>
              <b>{steps.length}</b>
            </button>
          ))}
          <button className="side-item" onClick={startChain}>
            {icon("plus", 16)}{" "}
            <span>{chainMarker ? "Создать цепочку" : "Настроить цепочки"}</span>
          </button>
        </section>
        <div className="side-section">
          <div className="side-heading">
            СЦЕНАРИИ <span>{projects.length}</span>
          </div>
          {(["goal", "fear", "unclassified"] as const).map((type) => {
            const group = projects.filter((p) => scenarioType(p) === type);
            if (!group.length) return null;
            const style = scenarioStyles[type];
            return (
              <section
                key={type}
                aria-label={style.group}
                className="scenario-group"
              >
                <div
                  className="scenario-group-title"
                  style={{ color: style.color }}
                >
                  {style.icon} {style.group}
                </div>
                {group.map((p) => (
                  <div key={p.id} className="project-row">
                    <button
                      className={`side-item ${
                        project === p.id ? "active" : ""
                      }`}
                      aria-pressed={project === p.id}
                      onClick={() => selectScenario(p.id)}
                    >
                      <span
                        className={`scenario-symbol ${type}`}
                        style={{ color: style.color }}
                        aria-hidden="true"
                      >
                        {style.icon}
                      </span>
                      <span>{p.title}</span>
                      <b>
                        {
                          filtered.filter((t) => t.scenarioTags.includes(p.id))
                            .length
                        }
                      </b>
                    </button>
                    {layouts[p.id]?.hidden && (
                      <button
                        className="tiny"
                        title="Вернуть сценарий на доску"
                        onClick={() => saveLayout(p.id, { hidden: false })}
                      >
                        ↗
                      </button>
                    )}
                  </div>
                ))}
              </section>
            );
          })}
          <form
            className="new-project"
            aria-label="Новый сценарий"
            aria-busy={creatingScenario}
            onSubmit={(e) => {
              e.preventDefault();
              void createScenario();
            }}
          >
            <label htmlFor="scenario-type">Добавить сценарий</label>
            <select
              id="scenario-type"
              aria-label="Тип нового сценария"
              value={newScenarioType}
              disabled={creatingScenario}
              onChange={(e) => {
                setNewScenarioType(e.target.value as "goal" | "fear");
                setScenarioError("");
                setScenarioMessage("");
              }}
            >
              <option value="goal">Цель</option>
              <option value="fear">Опасение</option>
            </select>
            <input
              ref={scenarioInput}
              aria-label="Название нового сценария"
              placeholder={
                newScenarioType === "goal"
                  ? "Название цели"
                  : "Название опасения"
              }
              value={newProject}
              disabled={creatingScenario}
              onChange={(e) => {
                setNewProject(e.target.value);
                setScenarioError("");
                setScenarioMessage("");
              }}
              maxLength={1000}
            />
            <button
              type="submit"
              aria-label="Создать сценарий"
              disabled={
                !newProject.trim() || !!scenarioSetupHint || creatingScenario
              }
            >
              {icon("plus", 16)}
              {creatingScenario
                ? "Добавляем…"
                : newScenarioType === "goal"
                ? "Добавить цель"
                : "Добавить опасение"}
            </button>
            {scenarioSetupHint && (
              <div className="scenario-create-hint">
                <p>{scenarioSetupHint}</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setSettingsOpen("board")}
                >
                  Открыть настройки →
                </button>
              </div>
            )}
            {scenarioError && (
              <p className="inline-error" role="alert">
                {scenarioError}
              </p>
            )}
            {scenarioMessage && (
              <p className="scenario-create-hint" role="status">
                {scenarioMessage}
              </p>
            )}
          </form>
        </div>
        <div className="side-bottom">
          <button
            className={`side-item ${hidden ? "active" : ""}`}
            onClick={() => {
              openTray(hidden ? null : "hidden");
            }}
          >
            {icon("eye")}
            <span>Скрытые карточки</span>
            <b>{views.filter((t) => t.layout.hidden).length}</b>
          </button>
          <label className="done-toggle">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />{" "}
            Показывать выполненные
          </label>
          <div className="sidebar-note">
            Задачи живут в Singularity.
            <br />
            Их расположение — здесь.
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="toolbar">
          <div className="board-title">
            <span className="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</span>
            <h1>
              {hidden
                ? "Скрытые карточки"
                : activeChain
                ? activeChain.parent.title
                : project
                ? projectMap.get(project)?.title
                : scenariosOnly
                ? "Цели и опасения"
                : "Матрица задач"}
            </h1>
          </div>
          <div className="toolbar-actions">
            {activeChain && (
              <button className="outline-button" onClick={clearSelection}>
                Снять подсветку
              </button>
            )}
            {scenarioForEditing &&
              scenarioForEditing.scenarioType !== "unclassified" && (
                <button
                  className="outline-button"
                  onClick={() => {
                    setTrayMode(null);
                    setSelected("");
                    setEdgeId("");
                    setRelationPanel(
                      relationPanel === "scenario" ? null : "scenario"
                    );
                  }}
                >
                  {scenarioForEditing.scenarioType === "fear"
                    ? "Ведёт к риску…"
                    : "Ведёт к цели…"}
                </button>
              )}
            {project && (
              <label className="only-project">
                <input
                  type="checkbox"
                  checked={onlyProject}
                  onChange={(e) => setOnlyProject(e.target.checked)}
                />
                Только этот сценарий
              </label>
            )}
            <label className="search">
              {icon("search", 16)}
              <input
                aria-label="Поиск задач"
                placeholder="Найти задачу…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  aria-label="Очистить поиск"
                  onClick={() => setSearch("")}
                >
                  ×
                </button>
              )}
            </label>
            <button
              className="outline-button"
              onClick={() => void act(() => api("/sync", "POST", {}))}
              disabled={board.sync.running}
            >
              {icon("sync", 15)}
              <span>Обновить</span>
            </button>
          </div>
        </div>
        {(error || offline || board.sync.error) && (
          <div className="error-banner" role="alert">
            <span>
              {error ||
                (offline
                  ? "Нет соединения с сервером. Несохранённые изменения остаются в этом окне."
                  : board.sync.error)}
            </span>
            <button
              onClick={() => {
                setError("");
                void refresh();
                void act(() => api("/sync", "POST", {}));
              }}
            >
              Повторить
            </button>
          </div>
        )}
        {problematic.length > 0 && (
          <button
            className="queue-banner"
            onClick={() => setOperationsOpen(true)}
          >
            {problematic.length} операций требуют внимания. Открыть ошибки и
            конфликты →
          </button>
        )}
        {saveError && (
          <div className="error-banner" role="alert">
            Раскладка не сохранена: {saveError}
            <button onClick={() => void flushLayouts()}>
              Повторить сохранение
            </button>
          </div>
        )}
        {!board.settings.rootTagId && (
          <div className="info-banner">
            Начните с настройки: выберите существующий корневой тег или создайте
            «Проекты доски».{" "}
            <button onClick={() => setSettingsOpen("board")}>Настроить</button>
          </div>
        )}
        <div className="matrix-tools">
          <span>Матрица расширяется по мере заполнения</span>
          <select
            className="compact-chain-select"
            aria-label="Цепочки задач"
            value=""
            onChange={(e) => {
              if (e.target.value === "new") startChain();
              else if (e.target.value) openChain(e.target.value);
            }}
          >
            <option value="">Цепочки…</option>
            <option value="new">
              {chainMarker ? "Создать цепочку" : "Настроить цепочки"}
            </option>
            {chains.map(({ parent }) => (
              <option key={parent.id} value={parent.id}>
                {parent.title}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={scenariosOnly}
              onChange={(e) => {
                setScenariosOnly(e.target.checked);
                if (e.target.checked) {
                  setChainId("");
                  setTrayMode(null);
                  if (relationPanel === "chain") setRelationPanel(null);
                  setSelected("");
                }
                setEdgeId("");
              }}
            />
            Только цели и опасения
          </label>
          <button
            className="text-button"
            onClick={() => queueMatrix(fitMatrix(views.map((t) => t.layout)))}
          >
            Подогнать границы
          </button>
          <label>
            Приблизить
            <select
              aria-label="Приблизить квадрант"
              value=""
              onChange={(e) => {
                if (e.target.value !== "")
                  focusQuadrant(Number(e.target.value));
              }}
            >
              <option value="">Квадрант…</option>
              {board.settings.quadrants.map((q, i) => (
                <option key={i} value={i}>
                  {q}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="canvas-area">
          {trayMode && (
            <TaskTray
              key={trayMode}
              tasks={listTasks}
              mode={trayMode}
              focus={jumpToTask}
              quadrants={board.settings.quadrants}
              select={selectTask}
              place={placeTask}
              close={() => {
                setTrayMode(null);
              }}
            />
          )}
          {relationPanel === "new-chain" && chainMarker && (
            <CreateChainPanel
              board={board}
              close={() => setRelationPanel(null)}
              created={openChain}
              refresh={refresh}
              requestId={createRequest}
              clearRequest={(key) => delete createRequests.current[key]}
            />
          )}
          {relationPanel === "chain" && activeChain && (
            <ChainPanel
              key={activeChain.parent.id}
              chain={activeChain}
              board={board}
              tasks={views}
              close={() => setRelationPanel(null)}
              select={selectTask}
              showOnBoard={(task) => {
                if (!task.layout.hidden && isPlaced(task.layout))
                  jumpToTask(task);
                else placeTask(task);
              }}
              refresh={refresh}
              requestId={createRequest}
              clearRequest={(key) => delete createRequests.current[key]}
            />
          )}
          {relationPanel === "scenario" && scenarioForEditing && (
            <ScenarioParentPanel
              key={scenarioForEditing.id}
              scenario={scenarioForEditing}
              candidates={projects.filter(
                (p) =>
                  p.scenarioType === scenarioForEditing.scenarioType &&
                  !scenarioFocus.has(p.id)
              )}
              board={board}
              refresh={refresh}
              close={() => setRelationPanel(null)}
            />
          )}
          <div
            data-testid="board-surface"
            className="flow-surface"
            ref={surface}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(TASK_DRAG_TYPE);
              const task = views.find((t) => t.id === id);
              if (!task || !flow) return;
              e.preventDefault();
              const p = flow.screenToFlowPosition({
                x: e.clientX,
                y: e.clientY,
              });
              saveLayout(id, {
                x: p.x - 125,
                y: p.y - 50,
                width: 250,
                height: 100,
                hidden: false,
              });
            }}
          >
            <svg className="scenario-markers" aria-hidden="true">
              <defs>
                <marker
                  id="scenario-goal-arrow"
                  markerWidth="12"
                  markerHeight="12"
                  viewBox="0 0 12 12"
                  refX="11"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M 1 1 L 11 6 L 1 11 Z" fill="#29a66a" />
                </marker>
                <marker
                  id="scenario-fear-dot"
                  markerWidth="12"
                  markerHeight="12"
                  viewBox="0 0 12 12"
                  refX="6"
                  refY="6"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <circle cx="6" cy="6" r="5" fill="#ef414b" />
                </marker>
                {[
                  { id: "scenario-fear-arrow", color: "#ef414b" },
                  { id: "chain-arrow", color: "#386fc3" },
                ].map(({ id, color }) => (
                  <marker
                    key={id}
                    id={id}
                    markerWidth="12"
                    markerHeight="12"
                    viewBox="0 0 12 12"
                    refX="11"
                    refY="6"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M 1 1 L 11 6 L 1 11 Z" fill={color} />
                  </marker>
                ))}
              </defs>
            </svg>
            <ReactFlow
              nodes={displayedNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onInit={(instance) => {
                setFlow(instance);
                void instance.setViewport(board.settings.viewport);
              }}
              onNodesChange={(changes) =>
                setNodes((n) => applyNodeChanges(changes, n))
              }
              onNodeDrag={(_, n) => growDuringDrag(n)}
              onNodeDragStop={(_, n) =>
                saveLayout(n.id, { x: n.position.x, y: n.position.y })
              }
              onNodeClick={(_, n) => {
                if (n.type === "task") selectTask(n.id);
                else if (n.type === "project") selectScenario(n.id);
              }}
              onPaneClick={clearSelection}
              onEdgeClick={(_, edge) => selectEdge(edge)}
              onClickCapture={(e) => {
                // The first click clears the selection before a double click.
                if (e.detail === 1) paneClickScenario.current = taskScenario;
              }}
              onDoubleClick={(e) => {
                if (
                  !(e.target as HTMLElement).classList.contains(
                    "react-flow__pane"
                  ) ||
                  !flow
                )
                  return;
                const scenario =
                  taskScenario ??
                  (e.detail === 2 ? paneClickScenario.current : undefined);
                paneClickScenario.current = undefined;
                const title = window
                  .prompt(
                    scenario
                      ? `Название новой задачи\n${taskScenarioLabel(scenario)}`
                      : "Название новой задачи"
                  )
                  ?.trim();
                if (!title) return;
                const pos = flow.screenToFlowPosition({
                  x: e.clientX,
                  y: e.clientY,
                });
                void act(() => createTask(title, scenario?.id, pos));
              }}
              onConnect={(c) => void connect(c)}
              isValidConnection={(c) =>
                projectMap.has(c.target || "") &&
                visible.some((t) => t.id === c.source && t.canEditScenarios)
              }
              onMoveEnd={(_, viewport) => {
                viewportDraft.current = viewport;
                clearTimeout(viewportTimer.current);
                viewportTimer.current = setTimeout(
                  () => void flushLayouts(),
                  600
                );
              }}
              minZoom={0.1}
              maxZoom={2}
              deleteKeyCode={null}
              zoomOnDoubleClick={false}
              nodesConnectable={!offline}
              onlyRenderVisibleElements={false}
              proOptions={{ hideAttribution: false }}
            >
              <Background
                color="#d5d9d9"
                gap={22}
                size={1}
                variant={BackgroundVariant.Dots}
              />
              <Controls
                showInteractive={false}
                showZoom={false}
                showFitView={false}
              >
                <ControlButton
                  aria-label="Увеличить масштаб"
                  title="Увеличить масштаб"
                  onClick={() => void flow?.zoomIn()}
                >
                  +
                </ControlButton>
                <ControlButton
                  aria-label="Уменьшить масштаб"
                  title="Уменьшить масштаб"
                  onClick={() => void flow?.zoomOut()}
                >
                  −
                </ControlButton>
                <ControlButton
                  aria-label="Показать всю доску"
                  title="Показать всю доску"
                  onClick={showBoard}
                >
                  ↗
                </ControlButton>
              </Controls>
            </ReactFlow>
          </div>
          <div className="canvas-hint">
            <span>Потяните полотно · колёсико: масштаб · боковое: сдвиг</span>
            <button onClick={showBoard}>Показать всё ↗</button>
          </div>
          {edge && (
            <div className="edge-actions">
              {icon("link", 16)}
              <span>
                {edge.data?.kind === "chain"
                  ? "Порядок шагов"
                  : edge.data?.kind === "tree"
                  ? "Связь сценариев"
                  : "Связь задачи со сценарием"}
              </span>
              {edge.data?.kind === "chain" ? (
                <button
                  className="text-button"
                  onClick={() => openChain(edge.data.chainId)}
                >
                  Открыть цепочку
                </button>
              ) : (
                <button
                  className="danger-text"
                  disabled={
                    edge.data?.kind !== "tree" &&
                    !visible.some(
                      (t) => t.id === edge.source && t.canEditScenarios
                    )
                  }
                  onClick={() =>
                    void act(async () => {
                      if (edge.data?.kind === "tree") {
                        await api(
                          `/tags/${encodeURIComponent(edge.source)}/parent`,
                          "PATCH",
                          { parentId: "", base: edge.target }
                        );
                      } else {
                        await api(
                          `/tasks/${encodeURIComponent(edge.source)}/tags`,
                          "POST",
                          { tagId: edge.target, add: false }
                        );
                      }
                      setEdgeId("");
                    })
                  }
                >
                  Убрать связь
                </button>
              )}
              <button aria-label="Закрыть связь" onClick={() => setEdgeId("")}>
                ×
              </button>
            </div>
          )}
          <form
            className="quick-add"
            onSubmit={(e) => {
              e.preventDefault();
              void createQuickTask();
            }}
          >
            {taskScenario && (
              <div
                id="quick-task-scenario"
                className={`quick-scenario ${taskScenario.scenarioType}`}
                role="status"
                title={taskScenario.title}
              >
                <span aria-hidden="true">
                  {scenarioStyle(taskScenario).icon}
                </span>
                <span>{taskScenarioLabel(taskScenario)}</span>
              </div>
            )}
            <div className="quick-add-row">
              <div className="quick-plus">{icon("plus", 20)}</div>
              <input
                aria-label="Новая задача"
                aria-describedby={
                  taskScenario ? "quick-task-scenario" : undefined
                }
                placeholder="О чём нужно позаботиться?"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                maxLength={1000}
              />
              <button type="submit" disabled={!quick.trim() || creating}>
                {creating ? "Создаём…" : "Добавить"}
                <kbd>↵</kbd>
              </button>
            </div>
          </form>
        </div>
        <footer className="status-bar">
          <div>
            <i
              className={
                offline || board.sync.error ? "status-dot error" : "status-dot"
              }
            />
            {board.sync.running
              ? "Обновление…"
              : board.sync.lastSuccess
              ? `Обновлено ${new Date(
                  board.sync.lastSuccess
                ).toLocaleTimeString("ru-RU", {
                  timeZone: board.settings.timezone,
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Ожидание синхронизации"}
            <span>·</span>
            {board.settings.timezone}
          </div>
          <div>
            {saving
              ? "Сохранение раскладки…"
              : saveError
              ? "Есть несохранённые изменения"
              : "Раскладка сохранена"}
            {queue.length > 0 && (
              <button onClick={() => setOperationsOpen(true)}>
                {" "}
                · В очереди: {queue.length}
              </button>
            )}
          </div>
        </footer>
      </main>
      {task && (
        <TaskEditor
          key={task.id}
          task={task}
          board={board}
          layout={layouts[task.id]}
          scenarioTags={selectedView?.scenarioTags ?? task.tags ?? []}
          canEditScenarios={selectedView?.canEditScenarios ?? false}
          close={() => setSelected("")}
          run={act}
          saveLayout={saveLayout}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          error={error}
          board={board}
          focusChainTag={settingsOpen === "chains"}
          close={() => setSettingsOpen(null)}
          run={act}
        />
      )}
      {operationsOpen && (
        <OperationsDialog
          error={error}
          operations={board.operations}
          close={() => setOperationsOpen(false)}
          run={act}
        />
      )}
    </div>
  );
}
