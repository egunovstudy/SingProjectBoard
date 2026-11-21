import React, { useState } from "react";
import { api, Operation, Raw } from "./types";
import { icon, statusNames, kindNames } from "./ui";
export default function OperationsDialog({
  operations,
  close,
  run,
  error,
}: {
  operations: Operation[];
  close: () => void;
  error: string;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [showAll, setShowAll] = useState(false);
  const items = operations
    .filter((o) => showAll || !["DONE", "CANCELLED"].includes(o.status))
    .slice()
    .reverse();
  const resolve = (id: string, action: string) =>
    void run(() => api(`/operations/${id}`, "POST", { action }));
  return (
    <div className="modal-backdrop">
      <section
        className="modal operations-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Операции синхронизации"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">СОХРАННОСТЬ ДАННЫХ</span>
            <h2>Операции синхронизации</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Закрыть операции"
            onClick={close}
          >
            {icon("close")}
          </button>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />{" "}
          Показать завершённые
        </label>
        {items.length === 0 && (
          <div className="empty-state">
            {icon("check", 32)}
            <h3>Всё сохранено</h3>
            <p>Здесь появятся ожидающие изменения и ошибки.</p>
          </div>
        )}
        {items.map((op) => (
          <article
            className={`operation ${op.status.toLowerCase()}`}
            key={op.id}
          >
            <div className="operation-title">
              <strong>{kindNames[op.kind] || op.kind}</strong>
              <span>{statusNames[op.status]}</span>
            </div>
            <p>{op.payload.data?.title || op.payload.title || op.entityId}</p>
            {op.detail.message && <p>{op.detail.message}</p>}
            {op.detail.conflicts &&
              Object.entries(op.detail.conflicts).map(([key, raw]) => {
                const d = raw as Raw;
                return (
                  <div className="conflict-values" key={key}>
                    <strong>{key}</strong>
                    <div>
                      <small>Было</small>
                      <pre>{JSON.stringify(d.before)}</pre>
                    </div>
                    <div>
                      <small>В Singularity</small>
                      <pre>{JSON.stringify(d.external)}</pre>
                    </div>
                    <div>
                      <small>Ваше изменение</small>
                      <pre>{JSON.stringify(d.ours)}</pre>
                    </div>
                  </div>
                );
              })}
            <div className="operation-actions">
              {op.status === "CONFLICT" && (
                <>
                  <button
                    className="primary"
                    onClick={() => resolve(op.id, "ours")}
                  >
                    Сохранить мой вариант
                  </button>
                  <button
                    className="outline-button"
                    onClick={() => resolve(op.id, "discard")}
                  >
                    Оставить внешний вариант
                  </button>
                </>
              )}
              {op.status === "ERROR" && !op.kind.startsWith("CREATE_") && (
                <button
                  className="outline-button"
                  onClick={() => resolve(op.id, "retry")}
                >
                  Повторить
                </button>
              )}
              {op.status === "UNCERTAIN" && op.kind === "CREATE_TASK" && (
                <button
                  className="outline-button"
                  onClick={() => resolve(op.id, "reconcile")}
                >
                  Сверить по externalId
                </button>
              )}
              {["ERROR", "UNCERTAIN", "PENDING"].includes(op.status) && (
                <button
                  className="text-button"
                  onClick={() => resolve(op.id, "discard")}
                >
                  {op.kind.startsWith("CREATE_")
                    ? "Подтверждаю ручную проверку, закрыть"
                    : "Отменить операцию"}
                </button>
              )}
            </div>
            {op.status === "UNCERTAIN" && (
              <p className="field-help">
                Запрос создания мог выполниться. Автоматического повтора нет.
                Для тега проверьте результат в Singularity и выберите
                существующий тег в настройках.
              </p>
            )}
          </article>
        ))}
        <p className="field-help">
          Изменения одной задачи отправляются последовательно. Свежая проверка
          перед записью снижает риск гонки; API не предоставляет подтверждённой
          условной записи.
        </p>
      </section>
    </div>
  );
}
