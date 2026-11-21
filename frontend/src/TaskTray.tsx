import React, { useEffect, useState } from "react";
import { isPlaced } from "./boardModel";
import type { BoardTask } from "./boardModel";
import { icon } from "./ui";
import { recurring } from "./types";
export const TASK_DRAG_TYPE = "application/x-singboard-task";
const PAGE_SIZE = 20;
export type TaskTrayMode = "all" | "inbox" | "hidden";

export default function TaskTray({
  tasks,
  mode,
  focus,
  quadrants,
  select,
  place,
  close,
}: {
  tasks: BoardTask[];
  mode: TaskTrayMode;
  focus: (task: BoardTask) => void;
  quadrants: string[];
  select: (id: string) => void;
  place: (task: BoardTask, quadrant?: number) => void;
  close: () => void;
}) {
  const hidden = mode === "hidden";
  const title =
    mode === "all"
      ? "Все задачи"
      : hidden
      ? "Скрытые карточки"
      : "Неразобранное";
  const [page, setPage] = useState(0);
  const [quadrant, setQuadrant] = useState("view");
  const [query, setQuery] = useState("");
  const matching = tasks.filter((t) =>
    t.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  );
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  useEffect(() => setPage(0), [query, mode]);
  return (
    <section
      className="task-tray nowheel nodrag nopan"
      aria-label={mode === "inbox" ? "Неразобранные задачи" : title}
    >
      <div className="tray-header">
        <div>
          <h2>{title}</h2>
          <small>{tasks.length} задач</small>
        </div>
        <button
          className="icon-button"
          aria-label="Закрыть список задач"
          onClick={close}
        >
          {icon("close", 16)}
        </button>
      </div>
      <p>
        {mode === "all"
          ? "Все задачи в выбранной области, включая неразобранные и скрытые. Выполненные — по переключателю слева."
          : hidden
          ? "Верните карточку на её прежнее место."
          : "Перетащите задачу на матрицу или нажмите ↗."}
      </p>
      {!hidden && (
        <label className="tray-destination">
          Разместить в
          <select
            aria-label="Квадрант для размещения"
            value={quadrant}
            onChange={(e) => setQuadrant(e.target.value)}
          >
            <option value="view">Текущий вид</option>
            {quadrants.map((q, i) => (
              <option key={i} value={i}>
                {q}
              </option>
            ))}
          </select>
        </label>
      )}
      <input
        className="tray-search"
        aria-label="Поиск в списке задач"
        placeholder="Поиск в списке…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="tray-items">
        {matching.length === 0 && (
          <p className="empty-list">Здесь пока пусто</p>
        )}
        {matching
          .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
          .map((t) => (
            <div
              className="tray-task"
              key={t.id}
              data-testid={`tray-${t.id}`}
              draggable={!t.layout.hidden && !isPlaced(t.layout)}
              onDragStart={(e) => {
                e.dataTransfer.setData(TASK_DRAG_TYPE, t.id);
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              {!t.layout.hidden && !isPlaced(t.layout) && (
                <span className="tray-grip" aria-hidden="true">
                  ⠿
                </span>
              )}
              <button className="tray-task-title" onClick={() => select(t.id)}>
                {t.title}
                {mode === "all" && (
                  <small>
                    {t.layout.hidden
                      ? "Скрыта с доски"
                      : isPlaced(t.layout)
                      ? "На матрице"
                      : "Неразобранное"}
                    {t.checked ? " · Выполнена" : ""}
                  </small>
                )}
                <small>
                  {recurring(t)
                    ? "↻ Повторяется"
                    : t.start?.slice(0, 10) || "Без даты"}
                </small>
              </button>
              <button
                className="tray-place"
                aria-label={
                  t.layout.hidden
                    ? "Вернуть карточку"
                    : isPlaced(t.layout)
                    ? "Показать на матрице"
                    : "Разместить на доске"
                }
                title={
                  t.layout.hidden
                    ? "Вернуть карточку"
                    : isPlaced(t.layout)
                    ? "Показать на матрице"
                    : "Разместить на доске"
                }
                onClick={() =>
                  !t.layout.hidden && isPlaced(t.layout)
                    ? focus(t)
                    : place(
                        t,
                        quadrant === "view" ? undefined : Number(quadrant)
                      )
                }
              >
                ↗
              </button>
            </div>
          ))}
      </div>
      <div className="tray-pagination">
        <button
          aria-label="Предыдущая страница задач"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          ←
        </button>
        <span>
          {current + 1} / {pages}
          {matching.length > 0 &&
            ` · ${current * PAGE_SIZE + 1}–${Math.min(
              (current + 1) * PAGE_SIZE,
              matching.length
            )}`}
        </span>
        <button
          aria-label="Следующая страница задач"
          disabled={current === pages - 1}
          onClick={() => setPage(current + 1)}
        >
          →
        </button>
      </div>
    </section>
  );
}
