import React, { useEffect, useRef, useState } from "react";
import { isPlaced } from "./boardModel";
import type { BoardTask } from "./boardModel";
import { canPositionStep } from "./chains";
import type { TaskChain } from "./chains";
import { availableTag } from "./scenarios";
import { api } from "./types";
import type { Board } from "./types";
import { icon, statusNames } from "./ui";

type RequestKeys = {
  requestId: (key: string) => string;
  clearRequest: (key: string) => void;
};

function PanelHeading({ title, close }: { title: string; close: () => void }) {
  return (
    <div className="tray-header">
      <h2>{title}</h2>
      <button
        className="icon-button"
        aria-label="Свернуть панель цепочки"
        onClick={close}
      >
        {icon("close", 16)}
      </button>
    </div>
  );
}

export function CreateChainPanel({
  board,
  close,
  created,
  refresh,
  requestId,
  clearRequest,
}: RequestKeys & {
  board: Board;
  close: () => void;
  created: (id: string) => void;
  refresh: () => Promise<void>;
}) {
  const projects = board.nativeProjects.filter(
    (tag) =>
      availableTag(tag) &&
      (!board.settings.projectIds.length ||
        board.settings.projectIds.includes(tag.id))
  );
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [operationId, setOperationId] = useState("");
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const operation = board.operations.find((op) => op.id === operationId);
  const resultId =
    operation?.status === "DONE" ? operation.detail.resultId : "";
  const waiting =
    sending ||
    (!!operationId &&
      !["ERROR", "CANCELLED"].includes(operation?.status || ""));
  useEffect(() => {
    if (resultId && board.tasks.some((task) => task.id === resultId))
      created(resultId);
  }, [resultId, board.tasks, created]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name || waiting || busy.current) return;
    const key = JSON.stringify(["chain", projectId, name]);
    busy.current = true;
    setSending(true);
    setError("");
    try {
      const response = await api("/chains", "POST", {
        title: name,
        projectId,
        requestId: requestId(key),
      });
      clearRequest(key);
      setOperationId(response.operationId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <section className="task-tray relations-panel" aria-label="Новая цепочка">
      <PanelHeading title="Новая цепочка" close={close} />
      <form className="relations-form" onSubmit={(e) => void submit(e)}>
        <label>
          Название цепочки
          <input
            value={title}
            maxLength={1000}
            disabled={waiting}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Проект Singularity
          <select
            value={projectId}
            disabled={waiting}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">Без проекта</option>
            {projects.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="primary"
          disabled={waiting || !title.trim()}
        >
          Создать цепочку
        </button>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {operationId && (
          <div role="status" className="field-help">
            {operation?.detail.message || "Создание цепочки в очереди"}
          </div>
        )}
      </form>
    </section>
  );
}

export function ChainPanel({
  chain,
  board,
  tasks,
  close,
  select,
  showOnBoard,
  refresh,
  requestId,
  clearRequest,
}: RequestKeys & {
  chain: TaskChain;
  board: Board;
  tasks: BoardTask[];
  close: () => void;
  select: (id: string) => void;
  showOnBoard: (task: BoardTask) => void;
  refresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [existing, setExisting] = useState("");
  const [source, setSource] = useState("new");
  const [anchor, setAnchor] = useState<string>();
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const operation = board.operations.find(
    (op) =>
      op.payload.chainId === chain.parent.id &&
      !["DONE", "CANCELLED"].includes(op.status)
  );
  const locked =
    sending ||
    !!operation ||
    (!!submitted && !board.operations.some((op) => op.id === submitted));
  const candidates = tasks
    .filter(
      (task) =>
        !task.parent && canPositionStep(task, chain, board.settings.chainTagId)
    )
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const defaultAnchor = chain.steps.at(-1)?.id || "";
  const afterId = anchor ?? defaultAnchor;
  const missingAnchor =
    !!afterId && !chain.steps.some((step) => step.id === afterId);
  const next = chain.steps.find((step) => !step.checked);
  const unplaced = chain.steps.filter(
    (step) => !step.layout.hidden && !isPlaced(step.layout)
  ).length;
  const stepsPath = `/chains/${encodeURIComponent(chain.parent.id)}/steps`;

  async function enqueue(action: () => Promise<{ operationId: string }>) {
    if (locked || busy.current) return;
    busy.current = true;
    setSending(true);
    setError("");
    try {
      setSubmitted((await action()).operationId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  const position = (step: BoardTask, afterId: string) =>
    api(`${stepsPath}/${encodeURIComponent(step.id)}`, "PATCH", {
      afterId,
      base: {
        parent: step.parent ?? null,
        parentOrder: step.parentOrder ?? null,
      },
    });
  const candidate = candidates.find((task) => task.id === existing);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (missingAnchor) return;
    if (source === "existing") {
      if (candidate)
        void enqueue(async () => {
          const response = await position(candidate, afterId);
          setExisting("");
          return response;
        });
      return;
    }
    const name = title.trim();
    if (!name) return;
    const key = JSON.stringify(["step", chain.parent.id, afterId, name]);
    void enqueue(async () => {
      const response = await api(stepsPath, "POST", {
        title: name,
        afterId,
        requestId: requestId(key),
      });
      clearRequest(key);
      setTitle("");
      return response;
    });
  }

  return (
    <section
      className="task-tray relations-panel chain-panel"
      aria-label="Шаги цепочки"
    >
      <PanelHeading title={chain.parent.title} close={close} />
      {unplaced > 0 && (
        <p className="chain-unplaced">В «Неразобранном» — {unplaced}</p>
      )}
      <ol className="chain-steps">
        {chain.steps.map((step, index) => {
          const editable = canPositionStep(
            step,
            chain,
            board.settings.chainTagId
          );
          const details = [
            step.checked
              ? "Завершена"
              : step.id === next?.id
              ? "Следующий шаг"
              : "",
            step.layout.hidden
              ? "Скрыта"
              : !isPlaced(step.layout)
              ? "Неразобранное"
              : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={step.id}
              className={step.id === next?.id ? "chain-next" : ""}
            >
              <span className="chain-number">{index + 1}</span>
              <button
                className="tray-task-title"
                onClick={() => select(step.id)}
              >
                {step.title}
                {details && <small>{details}</small>}
              </button>
              {editable && (
                <div className="chain-step-actions">
                  <button
                    type="button"
                    className="tiny"
                    disabled={locked || index === 0}
                    aria-label={`На шаг выше — ${step.title}`}
                    onClick={() =>
                      void enqueue(() =>
                        position(step, chain.steps[index - 2]?.id || "")
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="tiny"
                    disabled={locked || index === chain.steps.length - 1}
                    aria-label={`На шаг ниже — ${step.title}`}
                    onClick={() =>
                      void enqueue(() =>
                        position(step, chain.steps[index + 1].id)
                      )
                    }
                  >
                    ↓
                  </button>
                </div>
              )}
              <button
                type="button"
                className="tray-place"
                aria-label={`Показать на доске — ${step.title}`}
                onClick={() => showOnBoard(step)}
              >
                ↗
              </button>
            </li>
          );
        })}
      </ol>
      {chain.steps.length === 0 && <p>Добавьте первый шаг.</p>}
      <form className="relations-form" onSubmit={submit}>
        <label>
          Добавить шаг
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="new">Новая задача</option>
            <option value="existing">Существующая задача</option>
          </select>
        </label>
        {source === "existing" ? (
          <label>
            Задача из того же проекта и раздела
            <select
              value={candidate?.id || ""}
              onChange={(e) => setExisting(e.target.value)}
            >
              <option value="">Выберите задачу без родителя</option>
              {candidates.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Название шага
            <input
              value={title}
              maxLength={1000}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        {(chain.steps.length > 0 || missingAnchor) && (
          <label>
            Вставить шаг после
            <select value={afterId} onChange={(e) => setAnchor(e.target.value)}>
              <option value="">В начало</option>
              {missingAnchor && (
                <option value={afterId} disabled>
                  Выберите новое место
                </option>
              )}
              {chain.steps.map((step) => (
                <option key={step.id} value={step.id}>
                  {step.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className="primary"
          disabled={
            locked ||
            missingAnchor ||
            (source === "existing" ? !candidate : !title.trim())
          }
        >
          Добавить шаг
        </button>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {locked && (
          <div role="status" className="field-help">
            {operation
              ? statusNames[operation.status] +
                (operation.detail.message
                  ? " · " + operation.detail.message
                  : "")
              : "Изменение в очереди"}
          </div>
        )}
      </form>
    </section>
  );
}
