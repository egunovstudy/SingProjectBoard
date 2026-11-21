import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

async function resultId(request: APIRequestContext, operationId: string) {
  let id = "";
  await expect
    .poll(async () => {
      const board = await (await request.get("/api/board")).json();
      const operation = board.operations.find(
        (item: any) => item.id === operationId
      );
      id = operation?.detail.resultId || "";
      return operation?.status;
    })
    .toBe("DONE");
  return id;
}

test("дерево переезда читается из Singularity и редактируется на доске", async ({
  page,
  request,
}) => {
  async function goal(title: string) {
    const response = await request.post("/api/tags", {
      data: { title, scenarioType: "goal" },
    });
    expect(response.ok()).toBe(true);
    return resultId(request, (await response.json()).operationId);
  }

  const move = await goal("Переехать жить за город");
  const sell = await goal("Продать квартиру в городе");
  const search = await goal("Найти подходящий посёлок");
  await request.patch(`/api/demo/external/tags/${sell}`, {
    data: { parent: move },
  });
  await request.patch(`/api/demo/external/tags/${search}`, {
    data: { parent: move },
  });
  const { id: task } = await (
    await request.post("/api/demo/external/tasks", {
      data: { title: "Заказать оценку квартиры", tags: [sell] },
    })
  ).json();
  await request.put(`/api/layouts/${task}`, { data: { x: 400, y: 255 } });
  await expect
    .poll(async () => {
      await request.post("/api/sync", { data: {} });
      const board = await (await request.get("/api/board")).json();
      return board.tasks.some((item: any) => item.id === task);
    })
    .toBe(true);

  await page.goto("/");
  const sellArrow = page.getByLabel(
    "Продать квартиру в городе → Переехать жить за город",
    { exact: true }
  );
  const searchArrow = page.getByLabel(
    "Найти подходящий посёлок → Переехать жить за город",
    { exact: true }
  );
  await expect(sellArrow).toHaveCount(0);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Настройки доски" });
  await dialog.getByText("Предпросмотр связей (2)").click();
  await expect(
    dialog.getByText("Продать квартиру в городе → Переехать жить за город", {
      exact: true,
    })
  ).toBeVisible();
  await dialog
    .getByLabel("Показывать вложенность тегов как связи сценариев")
    .check();
  await dialog.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Настройки сохранены");
  await dialog.getByRole("button", { name: "Закрыть настройки" }).click();

  await expect(sellArrow).toHaveCount(1);
  await expect(searchArrow).toHaveCount(1);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /Переехать жить за город/ })
    .click();
  await page.getByLabel("Только этот сценарий").check();
  await expect(page.getByTestId(`task-${task}`)).toBeVisible();
  await expect(page.getByTestId("task-T-demo-4")).toHaveCount(0);
  await page.getByLabel("Только цели и опасения").check();
  await expect(page.getByTestId(`task-${task}`)).toHaveCount(0);
  await expect(sellArrow).toHaveCount(1);

  await page
    .locator(".sidebar")
    .getByRole("button", { name: /Продать квартиру в городе/ })
    .click();
  await page.getByRole("button", { name: "Ведёт к цели…" }).click();
  const editor = page.getByRole("region", { name: "Родительский сценарий" });
  await editor.getByLabel("Родительский сценарий").selectOption("");
  await editor.getByRole("button", { name: "Сохранить связь" }).click();
  await expect(sellArrow).toHaveCount(0);
  const board = await (await request.get("/api/board")).json();
  expect(board.tags.find((tag: any) => tag.id === sell).parent).toBe("A-goals");
  expect(board.tasks.find((item: any) => item.id === task).tags).toEqual([
    sell,
  ]);
});

test("цепочку можно создать на доске и переставить со стороны Singularity", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("region", { name: "Цепочки задач" })
    .getByRole("button", { name: "Создать цепочку" })
    .click();
  const form = page.getByRole("region", { name: "Новая цепочка" });
  await form.getByLabel("Название цепочки").fill("Гитара на стене");
  await form.getByRole("button", { name: "Создать цепочку" }).click();
  const panel = page.getByRole("region", { name: "Шаги цепочки" });
  await expect(panel).toBeVisible();
  await expect(page.locator(".flow-surface .dimmed")).toHaveCount(0);
  const step = (title: string) =>
    panel.getByRole("button", { name: new RegExp(`^${title}`) });
  const first = "Примерить крепление";
  const middle = "Просверлить два отверстия";
  const last = "Повесить гитару";
  for (const title of [first, last]) {
    await panel.getByLabel("Название шага").fill(title);
    await panel.getByRole("button", { name: "Добавить шаг" }).click();
    await expect(step(title)).toBeVisible();
  }
  await panel.getByLabel("Вставить шаг после").selectOption({ label: first });
  await panel.getByLabel("Название шага").fill(middle);
  await panel.getByRole("button", { name: "Добавить шаг" }).click();
  await expect(step(middle)).toBeVisible();
  await expect(panel.getByText("В «Неразобранном» — 3")).toBeVisible();
  await expect(panel.locator("ol li button.tray-task-title")).toHaveText([
    new RegExp(first),
    new RegExp(middle),
    new RegExp(last),
  ]);

  const board = await (await request.get("/api/board")).json();
  const parent = board.tasks.find(
    (task: any) => task.title === "Гитара на стене"
  );
  const steps = [first, middle, last].map((title) =>
    board.tasks.find(
      (task: any) => task.title === title && task.parent === parent.id
    )
  );
  for (const [index, task] of steps.entries()) {
    await request.put(`/api/layouts/${task.id}`, {
      data: { x: 100 + 280 * index, y: 300 },
    });
  }
  await expect(
    page.getByLabel(`${first} → ${middle}`, { exact: true })
  ).toHaveCount(1);
  await expect(
    page.getByLabel(`${middle} → ${last}`, { exact: true })
  ).toHaveCount(1);
  await expect(
    page.getByTestId(`task-${steps[0].id}`).getByText("Следующий шаг")
  ).toBeVisible();

  await request.patch(`/api/demo/external/tasks/${steps[2].id}`, {
    data: { parentOrder: -1 },
  });
  await expect
    .poll(async () => {
      await request.post("/api/sync", { data: {} });
      const next = await (await request.get("/api/board")).json();
      return next.tasks.find((task: any) => task.id === steps[2].id)
        ?.parentOrder;
    })
    .toBe(-1);
  await expect(
    page.getByLabel(`${last} → ${first}`, { exact: true })
  ).toHaveCount(1);
  await expect(
    page.getByTestId(`task-${steps[2].id}`).getByText("Следующий шаг")
  ).toBeVisible();
  await expect(page.getByTestId(`task-${steps[2].id}`).locator("..")).toHaveCSS(
    "opacity",
    "1"
  );
  await expect(page.locator(".react-flow__node-task.dimmed").first()).toBeVisible();
  await page.getByRole("button", { name: "Показать всё ↗", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".flow-surface .dimmed")).toHaveCount(0);
});
