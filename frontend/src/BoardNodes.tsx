import React, { useEffect, useRef } from "react";
import { AXIS } from "./matrixGeometry";
import type { MatrixSide } from "./matrixGeometry";
import type { MatrixBounds } from "./types";
import {
  Handle,
  NodeProps,
  NodeResizer,
  Position,
  useUpdateNodeInternals,
} from "reactflow";
import { readOnly, recurring } from "./types";
import type { BoardTask } from "./boardModel";
import { icon } from "./ui";
import { scenarioStyle, scenarioType } from "./scenarios";
function TaskCard({ data, selected, isConnectable }: NodeProps) {
  const task: BoardTask = data.task;
  return (
    <div
      className={`task-card ${task.checked ? "completed" : ""} ${
        selected ? "selected" : ""
      } ${data.nextStep ? "chain-next-card" : ""}`}
      style={{ borderTopColor: data.color }}
      data-testid={`task-${task.id}`}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={170}
        minHeight={80}
        maxWidth={1000}
        maxHeight={1000}
        onResizeEnd={(_, p) =>
          data.save(task.id, {
            x: p.x,
            y: p.y,
            width: p.width,
            height: p.height,
          })
        }
      />
      <div className="task-top">
        <button
          className="task-check nodrag"
          aria-label={task.checked ? "Возобновить задачу" : "Завершить задачу"}
          disabled={readOnly(task)}
          onClick={(e) => {
            e.stopPropagation();
            data.complete(task);
          }}
        >
          {task.checked ? icon("check", 12) : null}
        </button>
        <span>
          {recurring(task)
            ? "↻ Повторяется"
            : data.projectNames[0] || "Без сценария"}
        </span>
        {data.nextStep && (
          <span className="next-step-label">Следующий шаг</span>
        )}
        <span className="drag-mark">⠿</span>
      </div>
      <div className="task-title">{task.title}</div>
      <div className="task-meta">
        {task.start && <span>◷ {task.start.slice(0, 10)}</span>}
        {task.deadline && <span>До {task.deadline.slice(0, 10)}</span>}
        {data.projectNames.length > 1 && (
          <span className="multi">
            +{data.projectNames.length - 1} сценария
          </span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="task"
        aria-label={
          data.chainConnectable
            ? "Соединить с задачей или сценарием"
            : "Связать задачу со сценарием"
        }
        title={
          data.chainConnectable
            ? "Потяните к следующей задаче или сценарию"
            : "Потяните к сценарию"
        }
        isConnectable={isConnectable && task.canEditScenarios}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="chain-step"
        className={data.chainConnectable ? "chain-handle" : "relation-anchor"}
        aria-label="Соединить с предыдущей задачей"
        title="Сюда ведёт стрелка от предыдущей задачи"
        isConnectable={isConnectable && data.chainConnectable}
        isConnectableStart={false}
      />
    </div>
  );
}
function ProjectCard({ id, data, selected }: NodeProps) {
  const type = scenarioType(data.tag);
  const style = scenarioStyle(data.tag);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => updateNodeInternals(id), [id, type, updateNodeInternals]);
  return (
    <div
      data-testid={`scenario-${data.tag.id}`}
      className={`project-card scenario-${type} ${selected ? "selected" : ""} ${
        data.tag.missing ? "missing" : ""
      }`}
      style={{ borderLeftColor: data.color }}
    >
      <Handle
        type="target"
        position={type === "fear" ? Position.Top : Position.Left}
        id="project"
        aria-label="Связать со сценарием"
      />
      <Handle
        type="source"
        position={type === "fear" ? Position.Bottom : Position.Right}
        id="scenario-child"
        className="relation-anchor"
        isConnectable={false}
        style={type === "fear" ? { left: "34%" } : { top: "34%" }}
      />
      <Handle
        type="target"
        position={type === "fear" ? Position.Bottom : Position.Right}
        id="scenario-parent"
        className="relation-anchor"
        isConnectable={false}
        style={type === "fear" ? { left: "66%" } : { top: "66%" }}
      />
      <span className="project-kicker">
        <span className={`scenario-symbol ${type}`} aria-hidden="true">
          {style.icon}
        </span>{" "}
        {style.label} {data.tag.missing ? "· УДАЛЁН" : ""}
      </span>
      <strong title={data.tag.title}>{data.tag.title}</strong>
      <small>{data.count} задач · тег Singularity</small>
    </div>
  );
}
function BoundaryHandle({
  side,
  bounds,
  resize,
  getZoom,
}: {
  side: MatrixSide;
  bounds: MatrixBounds;
  resize: (side: MatrixSide, value: number) => void;
  getZoom: () => number;
}) {
  const drag = useRef<{ origin: number; value: number; zoom: number }>();
  const horizontal = side === "left" || side === "right";
  const names = {
    left: "левую",
    right: "правую",
    top: "верхнюю",
    bottom: "нижнюю",
  };
  return (
    <button
      className={`matrix-resize-handle ${side} nodrag nopan nowheel`}
      data-testid={`matrix-edge-${side}`}
      aria-label={`Изменить ${names[side]} границу матрицы`}
      title="Потяните границу; стрелки на клавиатуре также меняют размер"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        drag.current = {
          origin: horizontal ? e.clientX : e.clientY,
          value: bounds[side],
          zoom: getZoom(),
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        e.stopPropagation();
        const d = drag.current;
        resize(
          side,
          d.value + ((horizontal ? e.clientX : e.clientY) - d.origin) / d.zoom
        );
      }}
      onPointerUp={(e) => {
        drag.current = undefined;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 280 : 80;
        const delta = horizontal
          ? e.key === "ArrowLeft"
            ? -step
            : e.key === "ArrowRight"
            ? step
            : 0
          : e.key === "ArrowUp"
          ? -step
          : e.key === "ArrowDown"
          ? step
          : 0;
        if (delta) {
          e.preventDefault();
          e.stopPropagation();
          resize(side, bounds[side] + delta);
        }
      }}
    >
      <span aria-hidden="true">{horizontal ? "⋮" : "⋯"}</span>
    </button>
  );
}
function Matrix({ data }: NodeProps) {
  const b: MatrixBounds = data.bounds;
  const left = AXIS.x - b.left,
    right = b.right - AXIS.x,
    top = AXIS.y - b.top,
    bottom = b.bottom - AXIS.y;
  return (
    <div
      className="matrix-frame"
      style={{ width: left + right + 180, height: top + bottom + 164 }}
    >
      <div
        className="matrix"
        data-testid="matrix"
        style={{
          width: left + right,
          height: top + bottom,
          gridTemplateColumns: `${left}px ${right}px`,
          gridTemplateRows: `${top}px ${bottom}px`,
        }}
      >
        <div
          className="axis-block axis-question-x"
          data-testid="axis-question-x"
        >
          {data.settings.xAxis}
        </div>
        <div className="axis-block axis-part axis-left" style={{ width: left }}>
          {data.settings.axisLabels.left}
        </div>
        <div
          className="axis-block axis-part axis-right"
          style={{ left, width: right }}
        >
          {data.settings.axisLabels.right}
        </div>
        <div
          className="axis-block axis-question-y"
          data-testid="axis-question-y"
        >
          <span>{data.settings.yAxis}</span>
        </div>
        <div className="axis-block axis-part axis-top" style={{ height: top }}>
          <span>{data.settings.axisLabels.top}</span>
        </div>
        <div
          className="axis-block axis-part axis-bottom"
          style={{ top, height: bottom }}
        >
          <span>{data.settings.axisLabels.bottom}</span>
        </div>
        {data.settings.quadrants.map((name: string, i: number) => (
          <div
            key={i}
            className={`quadrant q${i}`}
            data-testid={`quadrant-${i}`}
          >
            <span className="quad-index">0{i + 1}</span>
            <span className="quad-name">{name}</span>
            <button
              className="quadrant-focus nodrag nopan"
              aria-label={`Приблизить ${name}`}
              title="Приблизить квадрант"
              onClick={(e) => {
                e.stopPropagation();
                data.focus(i);
              }}
            >
              ↗
            </button>
          </div>
        ))}
        {(["left", "right", "top", "bottom"] as const).map((side) => (
          <BoundaryHandle
            key={side}
            side={side}
            bounds={b}
            resize={data.resize}
            getZoom={data.getZoom}
          />
        ))}
      </div>
    </div>
  );
}
export const nodeTypes = {
  task: TaskCard,
  project: ProjectCard,
  matrix: Matrix,
};
