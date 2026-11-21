import React, { useEffect, useRef, useState } from "react";
import { isPlaced } from "./boardModel";
import type { BoardTask } from "./boardModel";
import { canPositionStep, moveChainStep } from "./chains";
import type { TaskChain } from "./chains";
import { availableTag } from "./scenarios";
import { api, taskLinkPath } from "./types";
import type { Board } from "./types";
import { icon, kindNames, statusNames } from "./ui";

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
  stepIds,
  configureMarker,
  close,
  created,
  refresh,
  requestId,
  clearRequest,
}: RequestKeys & {
  board: Board;
  stepIds?: readonly [string, string];
  configureMarker?: () => void;
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

  async function save(action: () => Promise<void>) {
    if (waiting || busy.current) return;
    busy.current = true;
    setSending(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name || configureMarker) return;
    const key = JSON.stringify(["chain", stepIds ?? projectId, name]);
    void save(async () => {
      const response = await api("/chains", "POST", {
        title: name,
        ...(stepIds ? { stepIds } : { projectId }),
        requestId: requestId(key),
      });
      clearRequest(key);
      setOperationId(response.operationId);
    });
  }

  return (
    <section className="task-tray relations-panel" aria-label="Новая цепочка">
      <PanelHeading title="Новая цепочка" close={close} />
      <form className="relations-form" onSubmit={submit}>
        {stepIds && (
          <>
            <ol className="initial-chain-steps">
              {stepIds.map((id) => (
                <li key={id}>
                  {board.tasks.find((task) => task.id === id)?.title ||
                    "Задача недоступна"}
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="outline-button"
              disabled={waiting}
              onClick={() =>
                void save(async () => {
                  await api(taskLinkPath(...stepIds), "PUT");
                  close();
                })
              }
            >
              Связать только на доске
            </button>
            <div className="field-help">
              Создание цепочки сделает эти задачи подзадачами в Singularity.
            </div>
          </>
        )}
        <label>
          Название цепочки
          <input
            value={title}
            maxLength={1000}
            disabled={waiting}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {!stepIds && (
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
        )}
        {configureMarker && (
          <button
            type="button"
            className="outline-button"
            onClick={configureMarker}
          >
            Выбрать тег цепочек
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={waiting || !title.trim() || !!configureMarker}
        >
          {stepIds ? "Создать цепочку в Singularity" : "Создать цепочку"}
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
  openOperations,
  linkOnBoard,
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
  openOperations: () => void;
  linkOnBoard: (operationId: string) => void;
  showOnBoard: (task: BoardTask) => void;
  refresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [existing, setExisting] = useState("");
  const [stepSource, setStepSource] = useState("new");
  const hasProject = !!chain.parent.projectId;
  const source = hasProject ? stepSource : "new";
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
    moveChainStep(chain.parent.id, step, afterId);
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
        {hasProject && (
          <label>
            Добавить шаг
            <select
              value={source}
              onChange={(e) => setStepSource(e.target.value)}
            >
              <option value="new">Новая задача</option>
              <option value="existing">Существующая задача</option>
            </select>
          </label>
        )}
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
              ? (kindNames[operation.kind] || operation.kind) +
                " · " +
                statusNames[operation.status] +
                (operation.detail.message
                  ? " · " + operation.detail.message
                  : "")
              : "Изменение в очереди"}
          </div>
        )}
        {operation?.canLinkOnBoard && (
          <button
            type="button"
            className="outline-button"
            onClick={() => linkOnBoard(operation.id)}
          >
            Связать только на доске
          </button>
        )}
        {operation &&
          ["ERROR", "CONFLICT", "UNCERTAIN"].includes(operation.status) && (
            <button
              type="button"
              className="outline-button"
              onClick={openOperations}
            >
              Открыть операции
            </button>
          )}
      </form>
    </section>
  );
}
