import { test, expect } from '@playwright/test';
import type { Task } from '../src/types';

async function board(request: any) { return (await request.get('/api/board')).json(); }
async function waitQueue(request: any, operationId: string) {
  await expect.poll(async()=>{const b=await board(request);return b.operations.find((o:any)=>o.id===operationId)?.status;}).toBe('DONE');
}

test('матрица, несколько сценариев и обычные теги; одна карточка на задачу', async ({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Матрица задач'})).toBeVisible();
  await expect(page.getByTestId('task-T-demo-0')).toHaveCount(1);
  await page.getByTestId('task-T-demo-0').click();
  const editor=page.getByRole('complementary',{name:'Свойства задачи'});
  await expect(editor.getByRole('checkbox',{name:'Продукт приносит пользу',exact:true})).toBeChecked();
  await expect(editor.getByRole('checkbox',{name:'Осваиваю новые навыки',exact:true})).toBeChecked();
  await expect(editor.getByText('#Обсудить',{exact:true})).toBeVisible();
  await expect(editor.getByText('#С телефона',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('быстрый ввод, редактирование и завершение задачи',async({page,request})=>{
  await page.goto('/');
  await page.getByLabel('Новая задача',{exact:true}).fill('Проверка быстрого ввода');
  await page.getByLabel('Новая задача',{exact:true}).press('Enter');
  await expect.poll(async()=> (await board(request)).tasks.filter((t:any)=>t.title==='Проверка быстрого ввода').length).toBe(1);
  await page.getByRole('button',{name:'Неразобранное',exact:false}).first().click();
  await page.getByRole('button',{name:'Проверка быстрого ввода',exact:true}).click();
  const editor=page.getByRole('complementary',{name:'Свойства задачи'});
  await editor.getByLabel('Название задачи',{exact:true}).fill('Изменённая задача');
  await editor.getByLabel('Дата начала',{exact:true}).fill('2026-11-11');
  await editor.getByLabel('Крайний срок',{exact:true}).fill('2026-11-15');
  await editor.getByLabel('Описание задачи',{exact:true}).fill('Описание без потери дня');
  await editor.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
  await expect.poll(async()=> (await board(request)).tasks.find((t:any)=>t.title==='Изменённая задача')?.start).toBe('2026-11-11');
  await editor.getByLabel('Закрыть свойства',{exact:true}).click();
  await page.getByRole('button',{name:'Изменённая задача',exact:true}).click();
  await editor.getByLabel('Выполнена',{exact:true}).check();
  await editor.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
  await expect.poll(async()=> (await board(request)).tasks.find((t:any)=>t.title==='Изменённая задача')?.checked).toBe(1);
});

test("быстрый ввод привязывает задачи к выбранной цели или опасению", async ({ page, request }) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Новая задача" });
  const form = page.locator(".quick-add");
  await page.getByTestId("scenario-A-project-0").click();
  await expect(form.getByRole("status")).toHaveText(/Для цели «Продукт приносит пользу»/);
  await expect(input).toHaveAccessibleDescription("Для цели «Продукт приносит пользу»");
  await input.fill("Задача для выбранной цели");
  await input.press("Enter");
  await expect.poll(async () =>
    (await board(request)).tasks.find((task: any) => task.title === "Задача для выбранной цели")?.tags
  ).toEqual(["A-project-0"]);

  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 64 } });
  await expect(form.getByRole("status")).toHaveCount(0);
  await page.locator(".sidebar").getByRole("button", { name: /Теряю важные файлы/ }).click();
  await expect(form.getByRole("status")).toHaveText(/Для опасения «Теряю важные файлы»/);
  await expect(input).toHaveAccessibleDescription("Для опасения «Теряю важные файлы»");
  await input.fill("Задача для выбранного опасения");
  await form.getByRole("button", { name: /^Добавить/ }).click();
  await expect.poll(async () =>
    (await board(request)).tasks.find((task: any) => task.title === "Задача для выбранного опасения")?.tags
  ).toEqual(["A-project-1"]);
});

test("двойной щелчок размещает задачу со связью с выбранным сценарием", async ({ page, request }) => {
  await page.goto("/");
  await page.locator(".sidebar").getByRole("button", { name: /Продукт приносит пользу/ }).click();
  const prompt = page.waitForEvent("dialog").then(async (dialog) => {
    const message = dialog.message();
    await dialog.accept("Задача на полотне для цели");
    return message;
  });
  const [message] = await Promise.all([
    prompt,
    page.locator(".react-flow__pane").dblclick({ position: { x: 20, y: 64 } }),
  ]);
  expect(message).toContain("Для цели «Продукт приносит пользу»");
  await expect.poll(async () => {
    const state = await board(request);
    const task = state.tasks.find((candidate: any) => candidate.title === "Задача на полотне для цели");
    return task && { tags: task.tags, layout: state.layouts[task.id] };
  }).toMatchObject({
    tags: ["A-project-0"],
    layout: { x: expect.any(Number), y: expect.any(Number) },
  });
});

test('связь со сценарием сохраняет обычные теги, скрытие обратимо',async({page,request})=>{
  await page.goto('/');await page.getByTestId('task-T-demo-0').click();
  const editor=page.getByRole('complementary',{name:'Свойства задачи'});
  await editor.getByRole('checkbox',{name:'Продукт приносит пользу',exact:true}).click();
  await expect.poll(async()=> (await board(request)).tasks.find((t:any)=>t.id==='T-demo-0')?.tags.includes('A-project-0')).toBe(false);
  let b=await board(request);let tags=b.tasks.find((t:any)=>t.id==='T-demo-0').tags;
  expect(tags).toEqual(expect.arrayContaining(['A-project-2','A-ordinary','A-phone']));
  await editor.getByRole('button',{name:'Скрыть с доски',exact:true}).click();
  await expect(page.getByTestId('task-T-demo-0')).toHaveCount(0);
  expect((await board(request)).tasks.find((t:any)=>t.id==='T-demo-0')).toBeTruthy();
  await page.getByRole('button',{name:'Скрытые карточки',exact:false}).click();
  await page.getByRole('button',{name:'Вернуть карточку',exact:true}).click();
  await expect(page.getByTestId('task-T-demo-0')).toHaveCount(1);
});

test('удаление требует подтверждения и убирает задачу с доски и из списка', async ({ page, request }) => {
  const title = 'Удаляемая задача для проверки';
  const creation = await request.post('/api/tasks', { data: { title, position: { x: 350, y: 140 } } });
  const { operationId } = await creation.json();
  await waitQueue(request, operationId);
  const id = (await board(request)).operations.find((op: any) => op.id === operationId).detail.resultId;

  await page.goto('/');
  const card = page.getByTestId(`task-${id}`);
  await card.click();
  const editor = page.getByRole('complementary', { name: 'Свойства задачи' });
  const actions = editor.locator('.editor-actions');
  await expect(actions.getByRole('button', { name: 'Скрыть с доски', exact: true })).toBeVisible();
  const remove = actions.getByRole('button', { name: 'Удалить задачу', exact: true });
  await expect(remove).toHaveCSS('color', 'rgb(180, 35, 44)');
  await expect(remove.locator('svg')).toBeVisible();

  const cancel = page.waitForEvent('dialog').then(async (dialog) => {
    const message = dialog.message();
    await dialog.dismiss();
    return message;
  });
  const [message] = await Promise.all([cancel, remove.click()]);
  expect(message).toContain(`«${title}»`);
  expect(message).toContain('безвозвратно');
  await expect(card).toBeVisible();
  expect((await board(request)).operations.some((op: any) => op.entityId === id)).toBe(false);

  const confirm = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await Promise.all([confirm, remove.click()]);
  await expect(card).toHaveCount(0);
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: /Все задачи/ }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  expect((await board(request)).tasks.some((task: any) => task.id === id)).toBe(false);
});

test('перемещение и масштаб сохраняются после перезагрузки',async({page,request})=>{
  await page.goto('/');
  const before=await board(request);const node=page.getByTestId('task-T-demo-3');
  const rect=await node.boundingBox();expect(rect).toBeTruthy();
  await page.mouse.move(rect!.x+rect!.width/2,rect!.y+rect!.height/2);
  await page.mouse.down();await page.mouse.move(rect!.x+rect!.width/2+65,rect!.y+rect!.height/2+45,{steps:10});await page.mouse.up();
  await expect.poll(async()=> (await board(request)).layouts['T-demo-3'].x).not.toBe(before.layouts['T-demo-3'].x);
  await page.getByRole('button',{name:'Увеличить масштаб',exact:true}).click();
  await expect.poll(async()=> (await board(request)).settings.viewport.zoom).toBeGreaterThan(before.settings.viewport.zoom);
  const saved=await board(request);await page.reload();await expect(node).toBeVisible();
  const after=await board(request);expect(after.layouts['T-demo-3']).toEqual(saved.layouts['T-demo-3']);
  expect(after.settings.viewport.zoom).toBeCloseTo(saved.settings.viewport.zoom);
});

test('внешние изменения попадают на доску и конфликт явно разрешается',async({page,request})=>{
  await page.goto('/');await page.getByTestId('task-T-demo-1').click();
  const editor=page.getByRole('complementary',{name:'Свойства задачи'});
  await editor.getByLabel('Название задачи',{exact:true}).fill('Мой вариант из браузера');
  await request.patch('/api/demo/external/tasks/T-demo-1',{data:{title:'Внешнее изменение'}});
  await editor.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
  await expect(page.getByRole('button',{name:/операций требуют внимания/})).toBeVisible();
  await page.getByRole('button',{name:/операций требуют внимания/}).click();
  const dialog=page.getByRole('dialog',{name:'Операции синхронизации'});
  await expect(dialog.getByText('Конфликт',{exact:true})).toBeVisible();
  await expect(dialog.getByText('"Внешнее изменение"',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Сохранить мой вариант',exact:true}).click();
  await expect.poll(async()=> (await board(request)).tasks.find((t:any)=>t.id==='T-demo-1')?.title).toBe('Мой вариант из браузера');
});

test('настройки матрицы и узкое окно',async({page,request})=>{
  await page.goto('/');await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Настройки доски'});
  await dialog.getByLabel('Название квадранта 1',{exact:true}).fill('Мой фокус');
  await dialog.getByRole('button',{name:'Сохранить настройки',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText('Настройки сохранены');
  await dialog.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.reload();await expect(page.getByText('Мой фокус',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByLabel('Новая задача',{exact:true})).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  expect(overflow).toBe(false);
});

test("связь повторяющейся задачи с опасением сохраняется при смене экземпляра", async ({ page, request }) => {
  const title = "Оплатить ежемесячный счёт";
  const fearTitle = "Теряю важные файлы";
  const tagId = "A-project-1";
  const external = "/api/demo/external/tasks";
  const create = async (data: object) => {
    const response = await request.post(external, { data: { title, ...data } });
    expect(response.ok()).toBe(true);
    return (await response.json()).id as string;
  };
  const template = await create({
    recurrence: { rule: "monthly" },
    tags: ["A-ordinary", "A-project-0"],
  });
  const first = await create({
    recurrenceGeneratorId: template,
    start: "2026-12-04",
  });
  const next = await create({
    recurrenceGeneratorId: template,
    start: "2027-01-04",
    tags: [tagId],
  });
  expect((await request.put(`/api/layouts/${template}`, { data: { x: 350, y: 120 } })).ok()).toBe(true);
  const viewport = { x: 150, y: 70, zoom: 0.45 };
  expect((await request.patch("/api/settings", { data: { viewport } })).ok()).toBe(true);
  const sync = async (): Promise<Task[]> => {
    expect((await request.post("/api/sync", { data: {} })).ok()).toBe(true);
    return (await board(request)).tasks;
  };
  await expect.poll(async () => (await sync()).some((task) => task.id === next)).toBe(true);

  await page.goto("/");
  await page.getByTestId(`task-${first}`).click();
  const editor = page.getByRole("complementary", { name: "Свойства задачи" });
  const fear = editor.getByRole("checkbox", { name: fearTitle, exact: true });
  const link = page.getByLabel(`${title}: помогает предотвратить — ${fearTitle}`, { exact: true });
  await expect(editor.getByLabel("Название задачи")).toBeDisabled();
  await expect(fear).toBeEnabled();
  await fear.click();
  await expect(fear).toBeChecked();
  await expect(link).toHaveCount(1);

  expect((await request.patch(`${external}/${first}`, { data: { checked: 1 } })).ok()).toBe(true);
  await expect.poll(async () => (await sync()).find((task) => task.id === first)?.checked).toBe(1);
  const card = page.getByTestId(`task-${next}`);
  await expect(card).toBeVisible();
  await expect(editor.getByLabel("Дата начала")).toHaveValue("2027-01-04");
  await expect(fear).toBeChecked();
  await expect(link).toHaveCount(1);

  await editor.getByLabel("Закрыть свойства").click();
  await link.dispatchEvent("click");
  await page.getByRole("button", { name: "Убрать связь" }).click();
  await expect(link).toHaveCount(0);
  const tasks: Task[] = (await board(request)).tasks;
  expect(tasks.find((task) => task.id === template)?.tags).toEqual(["A-ordinary", "A-project-0"]);
  expect(tasks.find((task) => task.id === next)?.tags).toEqual([tagId]);

  const source = card.getByLabel("Связать задачу со сценарием");
  const target = page.getByTestId(`scenario-${tagId}`).getByLabel("Связать со сценарием");
  await expect(target).toBeInViewport();
  await source.dragTo(target);
  await expect(link).toHaveCount(1);
});
