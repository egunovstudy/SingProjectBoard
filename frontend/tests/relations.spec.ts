import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

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

async function connectCards(page: Page, from: string, to: string) {
  const output = page
    .getByTestId(`task-${from}`)
    .locator('[data-handleid="task"]');
  const input = page
    .getByTestId(`task-${to}`)
    .getByLabel("Соединить с предыдущей задачей");
  await expect(output).toBeVisible();
  await expect(input).toBeVisible();
  const start = (await output.boundingBox())!;
  const end = (await input.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
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

test("перетаскивание между карточками связывает существующие задачи в цепочку", async ({
  page,
  request,
}) => {
  const first = "Подготовить список учебных материалов";
  const second = "Вынести материалы в Obsidian";
  const third = "Выбрать материал для начала";
  async function place(title: string, x: number) {
    const fields = {
      title,
      projectId: "P-demo",
      group: "Q-study",
      tags: ["A-ordinary"],
    };
    const response = await request.post("/api/demo/external/tasks", {
      data: fields,
    });
    expect(response.ok()).toBe(true);
    const { id } = await response.json();
    const layout = { x, y: 24, width: 250, height: 100 };
    await request.put(`/api/layouts/${id}`, { data: layout });
    return { id, fields, layout };
  }
  const [a, b, c] = await Promise.all([
    place(first, 200),
    place(second, 530),
    place(third, 860),
  ]);
  await request.patch("/api/settings", {
    data: { chainTagId: "", viewport: { x: 130, y: 160, zoom: 0.8 } },
  });
  await expect
    .poll(async () => {
      await request.post("/api/sync", { data: {} });
      const board = await (await request.get("/api/board")).json();
      return [a, b, c].every(({ id }) =>
        board.tasks.some((task: any) => task.id === id)
      );
    })
    .toBe(true);
  await page.goto("/");

  await connectCards(page, a.id, b.id);
  const form = page.getByRole("region", { name: "Новая цепочка" });
  await expect(form.getByRole("listitem")).toHaveText([first, second]);
  await form.getByRole("button", { name: "Связать только на доске" }).click();
  const boardArrow = page.getByLabel(`${first} → ${second} (на доске)`, {
    exact: true,
  });
  await expect(boardArrow).toHaveCount(1);
  await page.reload();
  await expect(boardArrow).toHaveCount(1);
  await boardArrow.dispatchEvent("click");
  await page.getByRole("button", { name: "Убрать связь" }).click();
  await expect(boardArrow).toHaveCount(0);

  await connectCards(page, a.id, b.id);
  await form.getByLabel("Название цепочки").fill("Учебные материалы");
  const create = form.getByRole("button", {
    name: "Создать цепочку в Singularity",
    exact: true,
  });
  await expect(create).toBeDisabled();
  await form.getByRole("button", { name: "Выбрать тег цепочек" }).click();
  const settings = page.getByRole("dialog", { name: "Настройки доски" });
  await settings.getByLabel("Тег цепочек").selectOption("A-chain");
  await settings.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(settings.getByRole("status")).toHaveText("Настройки сохранены");
  await settings.getByRole("button", { name: "Закрыть настройки" }).click();
  await create.click();
  const firstArrow = page.getByLabel(`${first} → ${second}`, { exact: true });
  await expect(firstArrow).toHaveCount(1);

  await connectCards(page, b.id, c.id);
  const secondArrow = page.getByLabel(`${second} → ${third}`, { exact: true });
  await expect(secondArrow).toHaveCount(1);
  await page.reload();
  await expect(firstArrow).toHaveCount(1);
  await expect(secondArrow).toHaveCount(1);

  const board = await (await request.get("/api/board")).json();
  const chain = board.tasks.find(
    (task: any) => task.title === "Учебные материалы"
  );
  expect(chain).toMatchObject({
    projectId: "P-demo",
    group: "Q-study",
    tags: ["A-chain"],
  });
  for (const { id, fields, layout } of [a, b, c]) {
    expect(board.tasks.find((task: any) => task.id === id)).toMatchObject({
      ...fields,
      parent: chain.id,
    });
    expect(board.layouts[id]).toMatchObject(layout);
  }
});

test("две задачи без проекта соединяются на доске и новый шаг создаётся в цепочке", async ({
  page,
  request,
}) => {
  const titles = ["Забрать инструмент", "Найти сервис"];
  const ids = await Promise.all(
    titles.map(async (title, index) => {
      const response = await request.post("/api/demo/external/tasks", {
        data: { title, projectId: "" },
      });
      expect(response.ok()).toBe(true);
      const { id } = await response.json();
      await request.put(`/api/layouts/${id}`, {
        data: { x: 200 + 330 * index, y: 476, width: 250, height: 100 },
      });
      return id as string;
    })
  );
  await request.patch("/api/settings", {
    data: { viewport: { x: 130, y: 140, zoom: 0.75 } },
  });
  const readBoard = async () => (await request.get("/api/board")).json();
  await expect
    .poll(async () => {
      await request.post("/api/sync", { data: {} });
      const board = await readBoard();
      return ids.every((id) => board.tasks.some((task: any) => task.id === id));
    })
    .toBe(true);
  const before = await readBoard();

  await page.goto("/");
  await connectCards(page, ids[0], ids[1]);
  const arrow = page.getByLabel(`${titles.join(" → ")} (на доске)`, {
    exact: true,
  });
  await expect(arrow).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Новая цепочка" })).toHaveCount(0);
  const board = await readBoard();
  expect(board.operations.map((operation: any) => operation.id)).toEqual(
    before.operations.map((operation: any) => operation.id)
  );
  expect(board.taskLinks).toContainEqual({ source: ids[0], target: ids[1] });
  await page.reload();
  await expect(arrow).toHaveCount(1);

  const chainTitle = "Ремонт инструмента";
  const stepTitle = "Отвезти инструмент";
  const response = await request.post("/api/chains", { data: { title: chainTitle } });
  expect(response.ok()).toBe(true);
  const chainId = await resultId(request, (await response.json()).operationId);
  const chainButton = page
    .getByRole("region", { name: "Цепочки задач" })
    .getByRole("button", { name: new RegExp(`^${chainTitle}`) });
  await chainButton.click();
  const panel = page.getByRole("region", { name: "Шаги цепочки" });
  await expect(panel.getByLabel("Добавить шаг")).toHaveCount(0);
  await panel.getByLabel("Название шага").fill(stepTitle);
  await panel.getByRole("button", { name: "Добавить шаг" }).click();
  await expect(panel.getByRole("button", { name: new RegExp(`^${stepTitle}`) })).toBeVisible();
  const saved = await readBoard();
  const step = saved.tasks.find((task: any) => task.title === stepTitle);
  expect(step.parent).toBe(chainId);

  await request.put(`/api/layouts/${step.id}`, {
    data: { x: 860, y: 476, width: 250, height: 100 },
  });
  await panel.getByLabel("Свернуть панель цепочки").click();
  await connectCards(page, ids[1], step.id);
  const chainArrow = page.getByLabel(`${titles[1]} → ${stepTitle} (на доске)`, {
    exact: true,
  });
  await expect(chainArrow).toHaveCount(1);
  await expect(chainButton.locator("b")).toHaveText("3");
  await chainButton.click();
  const rows = panel.locator("ol .tray-task-title");
  await expect(rows).toHaveText(
    [...titles, stepTitle].map((title) => new RegExp(`^${title}`))
  );
  for (const id of [...ids, step.id]) {
    await expect(page.getByTestId(`task-${id}`).locator("..")).not.toHaveClass(/dimmed/);
  }
  await expect(rows.first().getByText(/Следующий шаг/)).toBeVisible();
  await expect(panel.getByLabel("Вставить шаг после").locator("option")).toHaveText([
    "В начало",
    stepTitle,
  ]);

  await page.reload();
  await expect(chainButton.locator("b")).toHaveText("3");
  await chainButton.click();
  await expect(rows).toHaveCount(3);
  await chainArrow.dispatchEvent("click");
  await page.getByRole("button", { name: "Убрать связь" }).click();
  await expect(chainButton.locator("b")).toHaveText("1");
  await expect(rows).toHaveText([new RegExp(`^${stepTitle}`)]);
  await expect(arrow).toHaveCount(1);
});
