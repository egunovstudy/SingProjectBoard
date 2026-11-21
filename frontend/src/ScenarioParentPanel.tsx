import React, { useState } from "react";
import type { Board, Scenario } from "./types";
import { api } from "./types";
import { icon, statusNames } from "./ui";

export default function ScenarioParentPanel({
  scenario,
  candidates,
  board,
  refresh,
  close,
}: {
  scenario: Scenario;
  candidates: Scenario[];
  board: Board;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState<{ parentId: string; base: string }>();
  const [operationId, setOperationId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const current = candidates.some((p) => p.id === scenario.parent)
    ? scenario.parent!
    : "";
  const parentId = draft?.parentId ?? current;
  const operation = board.operations.find(
    (op) =>
      op.entityId === scenario.id &&
      op.kind === "MOVE_SCENARIO" &&
      !["DONE", "CANCELLED"].includes(op.status)
  );
  const busy =
    sending ||
    !!operation ||
    (!!operationId && !board.operations.some((op) => op.id === operationId));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || parentId === current) return;
    setError("");
    setSending(true);
    try {
      const response = await api(
        `/tags/${encodeURIComponent(scenario.id)}/parent`,
        "PATCH",
        {
          parentId,
          base: draft?.base ?? (scenario.parent || ""),
        }
      );
      setOperationId(response.operationId);
      setDraft(undefined);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <section
      className="task-tray relations-panel"
      aria-label="Родительский сценарий"
    >
      <div className="tray-header">
        <h2>{scenario.title}</h2>
        <button
          className="icon-button"
          aria-label="Закрыть связи сценария"
          onClick={close}
        >
          {icon("close", 16)}
        </button>
      </div>
      <form className="relations-form" onSubmit={(e) => void submit(e)}>
        <label>
          {scenario.scenarioType === "fear"
            ? "Ведёт к общему риску"
            : "Ведёт к общей цели"}
          <select
            aria-label="Родительский сценарий"
            value={parentId}
            onChange={(e) =>
              setDraft({
                parentId: e.target.value,
                base: draft?.base ?? (scenario.parent || ""),
              })
            }
            disabled={busy}
          >
            <option value="">Без родительского сценария</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="primary"
          disabled={busy || parentId === current}
        >
          Сохранить связь
        </button>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {busy && (
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
