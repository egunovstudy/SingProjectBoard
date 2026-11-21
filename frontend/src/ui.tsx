import React from "react";
export const colors = ["#648e70", "#ba7856", "#7185aa", "#9d79a0"];
export const statusNames: Record<string, string> = {
  PENDING: "Ожидает",
  SENDING: "Отправляется",
  DONE: "Сохранено",
  ERROR: "Ошибка",
  CONFLICT: "Конфликт",
  UNCERTAIN: "Результат неизвестен",
  CANCELLED: "Отменено",
};
export const kindNames: Record<string, string> = {
  CREATE_TASK: "Создание задачи",
  CREATE_TAG: "Создание тега сценария",
  PATCH_TASK: "Изменение задачи",
  DELETE_TASK: "Удаление задачи",
  TAG: "Изменение связи",
  MOVE_SCENARIO: "Изменение связи сценариев",
  MOVE_STEP: "Изменение порядка шагов",
};
export const icon = (name: string, size = 18) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {name === "plus" ? (
      <path d="M12 5v14M5 12h14" />
    ) : name === "search" ? (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ) : name === "sync" ? (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3" />
      </>
    ) : name === "settings" ? (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" fill="currentColor" />
        <circle cx="16" cy="17" r="3" fill="currentColor" />
      </>
    ) : name === "close" ? (
      <path d="m6 6 12 12M18 6 6 18" />
    ) : name === "inbox" ? (
      <>
        <path d="m6 4-4 12v4h20v-4L18 4H6Z" />
        <path d="M2 15h6l2 3h4l2-3h6" />
      </>
    ) : name === "grid" ? (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ) : name === "eye" ? (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : name === "trash" ? (
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M5 6l1 13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-13M10 10v7m4-7v7" />
    ) : name === "check" ? (
      <path d="m5 12 4 4L19 6" />
    ) : name === "link" ? (
      <>
        <path d="m10 13 4-4M9 16l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 5 0M15 8l2-2a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-5 0" />
      </>
    ) : (
      <>
        <path d="M7 12h10M12 7v10" />
        <circle cx="12" cy="12" r="9" />
      </>
    )}
  </svg>
);
