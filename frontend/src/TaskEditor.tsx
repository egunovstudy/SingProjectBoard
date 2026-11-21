import React, { useState } from "react";
import {
  api,
  Board,
  Layout,
  Raw,
  Task,
  noteText,
  readOnly,
  recurring,
  simpleNote,
} from "./types";
import { icon, statusNames } from "./ui";
import {
  activeScenarios,
  scenarioStyle,
  scenarioType,
  scenarioStyles,
} from "./scenarios";
import { taskLayoutId } from "./boardModel";
export default function TaskEditor({
  task,
  board,
  layout,
  scenarioTags,
  canEditScenarios,
  close,
  run,
  saveLayout,
}: {
  task: Task;
  board: Board;
  layout: Layout;
  scenarioTags: string[];
  canEditScenarios: boolean;
  close: () => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  saveLayout: (id: string, l: Layout) => void;
}) {
  const [initial] = useState(() => ({ ...task }));
  const [title, setTitle] = useState(task.title);
  const [start, setStart] = useState(task.start || "");
  const [deadline, setDeadline] = useState(task.deadline || "");
  const [checked, setChecked] = useState(task.checked === 1);
  const [note, setNote] = useState(
    simpleNote(task.note) ? noteText(task.note) : task.note || ""
  );
  const [raw, setRaw] = useState(!simpleNote(task.note));
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [localError, setLocalError] = useState("");
  const readonly = readOnly(task);
  const series = recurring(task);
  const layoutId = taskLayoutId(task);
  const projects = activeScenarios(board.projects);
  const operations = board.operations.filter(
    (o) =>
      (o.entityId === task.id || o.entityId === layoutId) &&
      !["DONE", "CANCELLED"].includes(o.status)
  );
  const deletion = operations.find((o) => o.kind === "DELETE_TASK");
  const pending = deleting || operations.length > 0;

  async function deleteTask() {
    if (readonly || deleting || deletion) return;
    const message =
      board.mode === "real"
        ? `Удалить задачу «${task.title}» из Singularity безвозвратно? Подзадачи тоже могут быть удалены.`
        : `Удалить задачу «${task.title}» из демоданных безвозвратно?`;
    if (!window.confirm(message)) return;
    setDeleting(true);
    try {
      await run(() => api(`/tasks/${encodeURIComponent(task.id)}`, "DELETE"));
    } finally {
      setDeleting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readonly || pending) return;
    setLocalError("");
    const changes: Raw = {};
    const base: Raw = {};
    const noteValue = raw
      ? note
      : JSON.stringify([{ insert: note.endsWith("\n") ? note : note + "\n" }]);
    const candidates: Raw = {
      title,
      start,
      deadline,
    };
    if (checked !== (initial.checked === 1))
      candidates.checked = checked ? 1 : 0;
    if (
      note !==
      (simpleNote(initial.note) ? noteText(initial.note) : initial.note || "")
    )
      candidates.note = noteValue;
    for (const [key, value] of Object.entries(candidates)) {
      if (value !== (initial[key] ?? (key === "checked" ? 0 : ""))) {
        changes[key] = value;
        base[key] = initial[key] ?? null;
      }
    }
    if (!Object.keys(changes).length) {
      setLocalError("Нет изменений");
      return;
    }
    if (changes.note && raw) {
      try {
        if (!Array.isArray(JSON.parse(note))) throw new Error();
      } catch {
        setLocalError("Описание должно быть JSON-массивом Quill Delta");
        return;
      }
    }
    await run(async () => {
      await api(`/tasks/${encodeURIComponent(task.id)}`, "PATCH", {
        changes,
        base,
      });
      setSaved(true);
    });
  }
  return (
    <aside className="editor" aria-label="Свойства задачи">
      <div className="panel-header">
        <span className="eyebrow">СВОЙСТВА ЗАДАЧИ</span>
        <button
          className="icon-button"
          aria-label="Закрыть свойства"
          onClick={close}
        >
          {icon("close")}
        </button>
      </div>
      {readonly && (
        <div className="info-box">
          {series && !task.crypted
            ? "Свойства повторяющейся задачи редактируются в Singularity."
            : task.crypted
            ? "Зашифрованная задача. Изменяйте её в Singularity."
            : "Задача недоступна во внешней системе."}
        </div>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <label>
          Название
          <textarea
            aria-label="Название задачи"
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={readonly || saved}
            maxLength={1000}
            required
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            disabled={readonly || saved}
          />{" "}
          Выполнена
        </label>
        <label>
          Начало / выполнение
          <input
            aria-label="Дата начала"
            value={start}
            placeholder="ГГГГ-ММ-ДД или ISO с часовым поясом"
            onChange={(e) => setStart(e.target.value)}
            disabled={readonly || saved}
          />
        </label>
        <label>
          Крайний срок
          <input
            aria-label="Крайний срок"
            value={deadline}
            placeholder="ГГГГ-ММ-ДД или ISO с часовым поясом"
            onChange={(e) => setDeadline(e.target.value)}
            disabled={readonly || saved}
          />
        </label>
        <p className="field-help">
          Даты без времени сохраняют календарный день. Даты со временем вводите
          в ISO 8601 со смещением, например +03:00.
        </p>
        <label>
          Описание {raw && <small>· Quill Delta JSON</small>}
          <textarea
            aria-label="Описание задачи"
            rows={6}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={readonly || saved}
          />
        </label>
        {raw && (
          <>
            <p className="note-preview">{noteText(task.note)}</p>
            <p className="field-help">
              Форматирование и вложения сохраняются в Delta. Редактируйте JSON
              или явно замените описание простым текстом.
            </p>
            <button
              type="button"
              className="text-button"
              disabled={readonly || saved}
              onClick={() => {
                setNote(noteText(task.note));
                setRaw(false);
              }}
            >
              Заменить описание простым текстом
            </button>
          </>
        )}
        {localError && (
          <p className="inline-error" role="alert">
            {localError}
          </p>
        )}
        {saved ? (
          <div className="info-box">
            Изменения в очереди. Результат виден в операциях синхронизации.
            Закройте и откройте задачу для следующего редактирования.
          </div>
        ) : (
          <button className="primary" disabled={readonly || pending}>
            Сохранить изменения
          </button>
        )}
      </form>
      <section className="editor-projects">
        <h3>Сценарии</h3>
        <p className="field-help">
          {series
            ? canEditScenarios
              ? "Связи сохраняются сразу для всей серии."
              : "Для изменения связей нужен доступный шаблон повторения в Singularity."
            : "Связи сохраняются сразу. Обычные теги остаются у задачи."}
        </p>
        {(["goal", "fear", "unclassified"] as const).map((type) => {
          const scenarios = projects.filter((p) => scenarioType(p) === type);
          if (!scenarios.length) return null;
          return (
            <section key={type} aria-label={scenarioStyles[type].group}>
              <h4 style={{ color: scenarioStyles[type].color }}>
                {type === "goal"
                  ? "Помогает достичь"
                  : type === "fear"
                  ? "Помогает предотвратить"
                  : "Без группы"}
              </h4>
              {scenarios.map((p) => (
                <label className="checkbox-label" key={p.id}>
                  <input
                    type="checkbox"
                    checked={scenarioTags.includes(p.id)}
                    disabled={!canEditScenarios || pending}
                    onChange={(e) =>
                      void run(() =>
                        api(
                          `/tasks/${encodeURIComponent(task.id)}/tags`,
                          "POST",
                          { tagId: p.id, add: e.target.checked }
                        )
                      )
                    }
                  />
                  <span
                    className={`scenario-symbol ${type}`}
                    style={{ color: scenarioStyle(p).color }}
                    aria-hidden="true"
                  >
                    {scenarioStyle(p).icon}
                  </span>
                  {p.title}
                </label>
              ))}
            </section>
          );
        })}
        <div className="ordinary-tags">
          {(task.tags || [])
            .filter((t) => !board.projects.some((p) => p.id === t))
            .map((id) => (
              <span key={id}>
                #{board.tags.find((t) => t.id === id)?.title || id}
              </span>
            ))}
        </div>
      </section>
      <div className="editor-bottom">
        <div className="editor-actions">
          <button
            className="outline-button"
            onClick={() => {
              saveLayout(task.id, { hidden: !layout?.hidden });
              close();
            }}
          >
            {icon("eye", 16)}
            {layout?.hidden ? "Вернуть на доску" : "Скрыть с доски"}
          </button>
          <button
            className="outline-button delete-task"
            disabled={readonly || deleting || !!deletion}
            onClick={() => void deleteTask()}
          >
            {icon("trash", 16)}
            Удалить задачу
          </button>
        </div>
        {deletion && (
          <p role="status">Удаление задачи · {statusNames[deletion.status]}</p>
        )}
        <p>Скрытие сохраняет задачу в Singularity.</p>
        <code>{task.id}</code>
      </div>
    </aside>
  );
}
