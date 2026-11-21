import React, { useEffect, useState, useRef } from "react";
import { api, Board } from "./types";
import { icon } from "./ui";
import {
  availableTag,
  chainMarkerCandidates,
  scenarioStyle,
  scenarioTree,
} from "./scenarios";
export default function SettingsDialog({
  board,
  close,
  run,
  error,
  focusChainTag,
}: {
  board: Board;
  close: () => void;
  error: string;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  focusChainTag: boolean;
}) {
  const [settings, setSettings] = useState({ ...board.settings });
  const rootRequests = useRef<Record<string, string>>({});
  const [rootName, setRootName] = useState("Проекты доски");
  const [message, setMessage] = useState("");
  const chainTagSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (focusChainTag) chainTagSelect.current?.focus();
  }, [focusChainTag]);
  const set = (key: string, value: unknown) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const markerCandidates = chainMarkerCandidates(
    board.tags,
    settings.rootTagId
  );
  const markerMissing =
    settings.chainTagId &&
    !markerCandidates.some((tag) => tag.id === settings.chainTagId);
  const markerPending = board.operations.some(
    (op) =>
      op.kind === "CREATE_TAG" &&
      op.payload.data?.title === "Цепочка" &&
      !op.payload.data?.parent &&
      !["DONE", "CANCELLED"].includes(op.status)
  );
  const previewSettings = { ...settings };
  for (const [key, title] of [
    ["goalTagId", "Цели"],
    ["fearTagId", "Опасения"],
  ] as const) {
    if (previewSettings[key]) continue;
    const matches = board.tags.filter(
      (tag) =>
        tag.parent === settings.rootTagId &&
        tag.title === title &&
        availableTag(tag)
    );
    if (matches.length === 1) previewSettings[key] = matches[0].id;
  }
  const preview = scenarioTree(board.tags, previewSettings);
  const tagNames = new Map(board.tags.map((tag) => [tag.id, tag.title]));
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Настройки доски"
        className="modal settings-modal"
      >
        <div className="panel-header">
          <div>
            <span className="eyebrow">ВАША МАТРИЦА</span>
            <h2>Настройки доски</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Закрыть настройки"
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const { matrixBounds, viewport, ...editable } = settings;
              await api("/settings", "PATCH", editable);
              setMessage("Настройки сохранены");
            });
          }}
        >
          <h3>Теги сценариев</h3>
          <label>
            Корневой тег
            <select
              aria-label="Корневой тег"
              value={settings.rootTagId}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  rootTagId: e.target.value,
                  goalTagId: "",
                  fearTagId: "",
                  scenarioHierarchy: false,
                }))
              }
            >
              <option value="">Не выбран</option>
              {board.tags
                .filter((t) => !t.missing)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} · {t.id}
                  </option>
                ))}
            </select>
          </label>
          <p className="field-help">
            В корне «Проекты доски» выберите две ветки: «Цели» и «Опасения».
            Сценариями станут их потомки; сами ветки карточками не показываются.
            Теги вне этих веток сохраняются в разделе «Без группы». При открытии
            доски теги не создаются.
          </p>
          <div className="inline-form">
            <input
              aria-label="Название корневого тега"
              value={rootName}
              onChange={(e) => setRootName(e.target.value)}
            />
            <button
              type="button"
              className="outline-button"
              onClick={() =>
                void run(async () => {
                  await api("/tags", "POST", {
                    title: rootName,
                    root: true,
                    requestId: (rootRequests.current[rootName] ||=
                      crypto.randomUUID()),
                  });
                  delete rootRequests.current[rootName];
                  setMessage(
                    "Создание корня в очереди. После выполнения выберите его в списке и сохраните."
                  );
                })
              }
            >
              Создать корень
            </button>
          </div>
          {(["goal", "fear"] as const).map((type) => {
            const key = `${type}TagId` as const;
            const label = type === "goal" ? "Ветка целей" : "Ветка опасений";
            const candidates = board.tags.filter(
              (t) => t.parent === settings.rootTagId
            );
            return (
              <div key={type} className="scenario-branch">
                <label>
                  {label}
                  <select
                    aria-label={label}
                    value={settings[key] || ""}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        [key]: e.target.value,
                        scenarioHierarchy: false,
                      }))
                    }
                  >
                    <option value="">Не выбрана</option>
                    {candidates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {t.missing ? " · удалена" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {!settings[key] && (
                  <button
                    type="button"
                    className="outline-button"
                    disabled={
                      !settings.rootTagId ||
                      settings.rootTagId !== board.settings.rootTagId ||
                      board.operations.some(
                        (o) =>
                          o.kind === "CREATE_TAG" &&
                          o.payload.data?.parent === settings.rootTagId &&
                          o.payload.data?.title ===
                            (type === "goal" ? "Цели" : "Опасения") &&
                          !["DONE", "CANCELLED"].includes(o.status)
                      )
                    }
                    onClick={() =>
                      void run(async () => {
                        const title = type === "goal" ? "Цели" : "Опасения";
                        const requestKey = settings.rootTagId + ":" + type;
                        await api("/tags", "POST", {
                          title,
                          branch: true,
                          scenarioType: type,
                          requestId: (rootRequests.current[requestKey] ||=
                            crypto.randomUUID()),
                        });
                        delete rootRequests.current[requestKey];
                        setMessage(
                          `Создание ветки «${title}» в очереди. После выполнения выберите её в списке и сохраните.`
                        );
                      })
                    }
                  >
                    Создать «{type === "goal" ? "Цели" : "Опасения"}»
                  </button>
                )}
              </div>
            );
          })}
          <p className="field-help">
            Сначала сохраните выбранный корень. Ветки запоминаются по ID: их
            переименование сохраняет тип сценариев. Цели располагаются справа от
            матрицы, опасения — снизу. Положение задач всегда выбираете вы.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.scenarioHierarchy}
              onChange={(e) => set("scenarioHierarchy", e.target.checked)}
            />
            Показывать вложенность тегов как связи сценариев
          </label>
          <p className="field-help">
            Стрелки идут от подцели к общей цели и от частного риска к общему.
            Проверьте вложения перед включением.
          </p>
          {preview.length > 0 && (
            <details className="scenario-preview">
              <summary>Предпросмотр связей ({preview.length})</summary>
              <ul>
                {preview.map(({ child, parent }) => (
                  <li key={child}>
                    {tagNames.get(child)} → {tagNames.get(parent)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <h3>Цепочки задач</h3>
          <label>
            Тег для родительских задач
            <select
              aria-label="Тег цепочек"
              ref={chainTagSelect}
              value={settings.chainTagId}
              onChange={(e) => set("chainTagId", e.target.value)}
            >
              <option value="">Не выбран</option>
              {markerMissing && (
                <option value={settings.chainTagId}>Недоступный тег</option>
              )}
              {markerCandidates.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.title} · {tag.id}
                </option>
              ))}
            </select>
          </label>
          <p className="field-help">
            Пометьте этим тегом задачу. Её прямые подзадачи появятся на доске
            как цепочка в ручном порядке Singularity.
          </p>
          {!markerCandidates.some((tag) => tag.title === "Цепочка") && (
            <button
              type="button"
              className="outline-button"
              disabled={markerPending}
              onClick={() =>
                void run(async () => {
                  await api("/tags", "POST", {
                    title: "Цепочка",
                    root: true,
                    requestId: (rootRequests.current.chainMarker ||=
                      crypto.randomUUID()),
                  });
                  delete rootRequests.current.chainMarker;
                  setMessage(
                    "Создание тега в очереди. После выполнения выберите тег «Цепочка» и сохраните."
                  );
                })
              }
            >
              Создать тег «Цепочка»
            </button>
          )}
          <h3>Сценарии на доске</h3>
          <p className="field-help">
            Существующие теги сценариев можно добавить или скрыть без удаления.
            Связи задач останутся в Singularity.
          </p>
          {board.projects.map((p) => (
            <label key={p.id} className="checkbox-label">
              <input
                type="checkbox"
                checked={!board.layouts[p.id]?.hidden}
                onChange={(e) =>
                  void run(() =>
                    api(`/layouts/${encodeURIComponent(p.id)}`, "PUT", {
                      hidden: !e.target.checked,
                    })
                  )
                }
              />
              <span
                style={{ color: scenarioStyle(p).color }}
                aria-hidden="true"
              >
                {scenarioStyle(p).icon}
              </span>{" "}
              {p.title}
              {p.missing ? " · удалён" : ""}
            </label>
          ))}
          <h3>Матрица</h3>
          <div className="two-cols">
            <label>
              Вопрос над матрицей
              <input
                value={settings.xAxis}
                onChange={(e) => set("xAxis", e.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              Вопрос слева от матрицы
              <input
                value={settings.yAxis}
                onChange={(e) => set("yAxis", e.target.value)}
                maxLength={100}
              />
            </label>
            {(
              [
                ["left", "Подпись слева"],
                ["right", "Подпись справа"],
                ["top", "Подпись сверху"],
                ["bottom", "Подпись снизу"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  value={settings.axisLabels[key]}
                  onChange={(e) =>
                    set("axisLabels", {
                      ...settings.axisLabels,
                      [key]: e.target.value,
                    })
                  }
                  maxLength={200}
                />
              </label>
            ))}
            {settings.quadrants.map((q, i) => (
              <label key={i}>
                Квадрант {i + 1}
                <input
                  aria-label={`Название квадранта ${i + 1}`}
                  value={q}
                  onChange={(e) =>
                    set(
                      "quadrants",
                      settings.quadrants.map((v, j) =>
                        i === j ? e.target.value : v
                      )
                    )
                  }
                  required
                  maxLength={100}
                />
              </label>
            ))}
          </div>
          <h3>Синхронизация</h3>
          <div className="two-cols">
            <label>
              Интервал, секунд
              <input
                type="number"
                min={15}
                max={3600}
                value={settings.syncSeconds}
                onChange={(e) => set("syncSeconds", Number(e.target.value))}
              />
            </label>
            <label>
              Часовой пояс
              <input
                value={settings.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              />
            </label>
          </div>
          <p className="field-help">
            По умолчанию — активные задачи личного аккаунта. Выполненные
            доступны переключателем на доске. Выберите родные проекты
            Singularity, чтобы ограничить область; раскладка останется в базе.
          </p>
          <div className="native-projects">
            {board.nativeProjects
              .filter((p) => !p.missing)
              .map((p) => (
                <label className="checkbox-label" key={p.id}>
                  <input
                    type="checkbox"
                    checked={settings.projectIds.includes(p.id)}
                    onChange={(e) =>
                      set(
                        "projectIds",
                        e.target.checked
                          ? [...settings.projectIds, p.id]
                          : settings.projectIds.filter((id) => id !== p.id)
                      )
                    }
                  />
                  {p.title}
                </label>
              ))}
            {settings.projectIds.length === 0 && (
              <small>Область: все личные проекты</small>
            )}
          </div>
          <div className="info-box">
            Режим:{" "}
            {board.mode === "demo"
              ? "демонстрационный, без обращений к аккаунту"
              : "реальный аккаунт"}
            . Меняется серверной переменной APP_MODE. Токен хранится только на
            сервере.
          </div>
          {message && <p role="status">{message}</p>}
          <div className="modal-footer">
            <button type="button" className="outline-button" onClick={close}>
              Закрыть
            </button>
            <button className="primary">Сохранить настройки</button>
          </div>
        </form>
      </section>
    </div>
  );
}
