import {test,expect} from '@playwright/test';
import type {Scenario} from '../src/types';

function fixture() {
  const tasks:any[]=[{id:'T-placed',title:'На матрице',tags:[],checked:0},
    ...Array.from({length:200},(_,i)=>({id:`T-inbox-${i}`,title:`Входящая задача ${String(i).padStart(3,'0')}`,tags:[],checked:0})),
    {id:'T-series',title:'Повторяющаяся задача',tags:[],checked:0,recurrence:{rule:'daily'}},
    ...Array.from({length:100},(_,i)=>({id:`T-repeat-${i}`,title:'Повторяющаяся задача',tags:[],checked:0,start:`2026-${String(1+Math.floor(i/28)).padStart(2,'0')}-${String(1+i%28).padStart(2,'0')}`,recurrenceGeneratorId:'T-series'})),
    {id:'T-independent-1',title:'Одинаковые названия',tags:[],checked:0},
    {id:'T-independent-2',title:'Одинаковые названия',tags:[],checked:0}];
  return {mode:'demo',tasks,tags:[],projects:[] as Scenario[],nativeProjects:[],operations:[],sync:{running:false,lastSuccess:Date.now(),error:''},
    layouts:{'T-placed':{x:80,y:120,width:250,height:100},'T-series':{x:650,y:120,width:250,height:100}} as Record<string,any>,
    settings:{rootTagId:'',timezone:'Europe/Moscow',syncSeconds:60,xAxis:'Если эту задачу сделать, то…',yAxis:'Если эту задачу не сделать, то…',
      axisLabels:{left:'Левая часть матрицы',right:'Правая часть матрицы',top:'Верхняя часть матрицы',bottom:'Нижняя часть матрицы'},
      quadrants:['Квадрант I','Квадрант II','Квадрант III','Квадрант IV'],projectIds:[],matrixBounds:{left:0,top:0,right:1100,bottom:900},viewport:{x:150,y:140,zoom:0.65}}};
}
async function openBoard(page:any, configure: (state: ReturnType<typeof fixture>) => void = () => {}) {
  const state=fixture();
  configure(state);
  const writes:string[]=[];
  await page.route('**/api/**',async(route:any)=>{
    const req=route.request();const path=new URL(req.url()).pathname;const method=req.method();
    if(method!=='GET')writes.push(path);
    if(path==='/api/board')return route.fulfill({json:state});
    if(path==='/api/settings'&&method==='PATCH'){Object.assign(state.settings,req.postDataJSON());return route.fulfill({json:state.settings});}
    if(path.startsWith('/api/layouts/')&&method==='PUT'){
      const id=decodeURIComponent(path.slice('/api/layouts/'.length));
      state.layouts[id]={...state.layouts[id],...req.postDataJSON()};return route.fulfill({status:200,body:''});
    }
    return route.fulfill({json:{}});
  });
  await page.goto('/');await expect(page.getByTestId('task-T-placed')).toBeVisible();
  return {state,writes};
}
async function camera(page:any){return page.locator('.react-flow__viewport').evaluate((el:any)=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return{x:m.m41,y:m.m42,zoom:m.m11};});}

test("подсветка выделяет только связанную группу, а общий обзор снимает выделение", async ({ page }) => {
  await openBoard(page, (state) => {
    state.projects = [
      { id: "A-goal", title: "Цель на доске", scenarioType: "goal" },
      { id: "A-fear", title: "Опасение на доске", scenarioType: "fear" },
    ];
    state.tasks[0].tags = ["A-goal"];
    state.tasks.push({
      id: "T-fear",
      title: "Предотвратить риск",
      tags: ["A-fear"],
      checked: 1,
    });
    state.layouts["T-fear"] = { x: 100, y: 600, width: 250, height: 100 };
    state.layouts["A-fear"] = { x: -170, y: 1030 };
  });
  await page.getByLabel("Показывать выполненные").check();
  const goalTask = page.getByTestId("task-T-placed");
  const fearTask = page.getByTestId("task-T-fear");
  const goal = page.getByTestId("scenario-A-goal");
  const fear = page.getByTestId("scenario-A-fear");
  const goalLink = page.getByLabel(
    "На матрице: помогает достичь — Цель на доске",
    { exact: true }
  );
  const dimmed = page.locator(".flow-surface .dimmed");
  const overview = page.getByRole("button", {
    name: "Показать всё ↗",
    exact: true,
  });
  const sidebarGoal = page.locator(".sidebar").getByRole("button", {
    name: /Цель на доске/,
  });

  await expect(fearTask.locator(".task-title")).toHaveCSS("opacity", "1");
  await expect(dimmed).toHaveCount(0);
  await sidebarGoal.click();
  await expect(goal.locator("..")).toHaveCSS("opacity", "1");
  await expect(goalTask.locator("..")).toHaveCSS("opacity", "1");
  await expect(goalLink).toHaveCSS("opacity", "1");
  await expect(fear.locator("..")).not.toHaveCSS("opacity", "1");
  await expect(fearTask.locator("..")).not.toHaveCSS("opacity", "1");

  await page.getByLabel("Только этот сценарий").check();
  await expect(fearTask).toHaveCount(0);
  await overview.click();
  await expect(sidebarGoal).toHaveAttribute("aria-pressed", "false");
  await expect(fearTask).toBeInViewport();
  await expect(dimmed).toHaveCount(0);

  await fear.click();
  await expect(fear.locator("..")).toHaveCSS("opacity", "1");
  await expect(fearTask.locator("..")).toHaveCSS("opacity", "1");
  await expect(goalTask.locator("..")).not.toHaveCSS("opacity", "1");
  await expect(goalLink).not.toHaveCSS("opacity", "1");

  await goalTask.click();
  const editor = page.getByRole("complementary", { name: "Свойства задачи" });
  await expect(editor).toBeVisible();
  await expect(goalTask.locator("..")).toHaveCSS("opacity", "1");
  await expect(goal.locator("..")).not.toHaveCSS("opacity", "1");
  await expect(fearTask.locator("..")).not.toHaveCSS("opacity", "1");
  await page.locator(".react-flow__pane").dispatchEvent("click");
  await expect(editor).toHaveCount(0);
  await expect(dimmed).toHaveCount(0);

  await goalLink.dispatchEvent("click");
  await expect(page.getByLabel("Закрыть связь")).toBeVisible();
  await expect(goal.locator("..")).toHaveCSS("opacity", "1");
  await expect(goalTask.locator("..")).toHaveCSS("opacity", "1");
  await expect(fearTask.locator("..")).not.toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Показать всю доску", exact: true }).click();
  await expect(page.getByLabel("Закрыть связь")).toHaveCount(0);
  await expect(dimmed).toHaveCount(0);
});

test('удалённые теги скрыты, пустые остаются; удаление выбранного тега сбрасывает фильтр',async({page})=>{
  const {state,writes}=await openBoard(page,state=>{
    state.projects=[{id:'A-live',title:'Действующая цель',scenarioType:'goal'},
      {id:'A-empty',title:'Пустой сценарий',scenarioType:'fear'},
      {id:'A-missing',title:'Удалённый тег',scenarioType:'unclassified',missing:true}];
    state.tasks[0].tags=['A-live','A-missing'];
    state.layouts['A-live']={x:1330,y:270,width:230,height:104};
  });
  const sidebar=page.locator('.sidebar');
  await expect(page.getByTestId('scenario-A-live')).toHaveCount(1);
  await expect(page.getByTestId('scenario-A-empty')).toHaveCount(1);
  await expect(page.getByTestId('scenario-A-missing')).toHaveCount(0);
  await expect(sidebar.getByText('Пустой сценарий',{exact:true})).toBeVisible();
  await expect(sidebar.getByText('Удалённый тег',{exact:true})).toHaveCount(0);
  await page.getByTestId('task-T-placed').click();
  const editor=page.getByRole('complementary',{name:'Свойства задачи'});
  await expect(editor.getByLabel('Пустой сценарий',{exact:true})).toBeEnabled();
  await expect(editor.getByLabel('Удалённый тег',{exact:true})).toHaveCount(0);
  await editor.getByLabel('Закрыть свойства',{exact:true}).click();
  await page.getByPlaceholder('Найти задачу…').fill('Нет совпадений');
  await expect(page.getByTestId('task-T-placed')).toHaveCount(0);
  await expect(page.getByTestId('scenario-A-live')).toHaveCount(1);
  await page.getByPlaceholder('Найти задачу…').fill('');
  await sidebar.getByRole('button',{name:/Действующая цель/}).click();
  await page.getByLabel('Только этот сценарий',{exact:true}).check();
  state.tasks[0].tags=[];
  const saved={...state.layouts['A-live']};
  await expect(page.getByTestId('task-T-placed')).toHaveCount(0);
  await expect(page.getByTestId('scenario-A-live')).toHaveCount(1);
  state.projects[0].missing=true;
  await expect(page.getByTestId('scenario-A-live')).toHaveCount(0);
  await expect(sidebar.getByText('Действующая цель',{exact:true})).toHaveCount(0);
  await expect(page.getByTestId('task-T-placed')).toHaveCount(1);
  state.projects[0].missing=false;
  await expect(page.getByTestId('scenario-A-live')).toHaveCount(1);
  expect(state.layouts['A-live']).toEqual(saved);
  await expect(page.locator('.react-flow__node-project[data-id="A-live"]')).toHaveCSS('transform',`matrix(1, 0, 0, 1, ${saved.x}, ${saved.y})`);
  expect(writes).toEqual([]);
});

test('дополнительное колесо сдвигает полотно и сохраняет масштаб',async({page})=>{
  const {state}=await openBoard(page);
  const rect=(await page.getByTestId('board-surface').boundingBox())!;
  await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.65);
  const before=await camera(page);await page.mouse.wheel(140,0);
  await expect.poll(async()=>(await camera(page)).x).toBeLessThan(before.x-100);
  const after=await camera(page);expect(after.zoom).toBeCloseTo(before.zoom);expect(after.y).toBeCloseTo(before.y);
  await expect.poll(()=>state.settings.viewport.x).toBeCloseTo(after.x);
  await page.mouse.wheel(0,-100);
  await expect.poll(async()=>(await camera(page)).zoom).toBeGreaterThan(before.zoom);
});

test('сотни входящих не превращаются в столбик и не уменьшают доску',async({page})=>{
  await openBoard(page);
  await expect(page.locator('.react-flow__node-task')).toHaveCount(2);
  await page.getByRole('button',{name:'Показать всё ↗',exact:true}).click();
  await expect.poll(async()=>(await camera(page)).zoom).toBeGreaterThan(.25);
  await page.getByRole('button',{name:/Неразобранное/}).click();
  const tray=page.getByRole('region',{name:'Неразобранные задачи'});
  await expect(tray.locator('.tray-task')).toHaveCount(20);
  await expect(tray.getByText('202 задач',{exact:true})).toBeVisible();
  await tray.getByRole('button',{name:'Следующая страница задач'}).click();
  await expect(tray.getByTestId('tray-T-inbox-20')).toBeVisible();
  await tray.getByLabel('Поиск в списке задач').fill('Одинаковые названия');
  await expect(tray.locator('.tray-task')).toHaveCount(2);
  const rect=(await tray.boundingBox())!;const before=await camera(page);
  await page.mouse.move(rect.x+70,rect.y+100);await page.mouse.wheel(100,0);
  expect((await camera(page)).x).toBeCloseTo(before.x);
});

test('размещение из списка и drag-and-drop сохраняют только раскладку',async({page})=>{
  const {state,writes}=await openBoard(page);
  await page.getByRole('button',{name:/Неразобранное/}).click();
  const tray=page.getByRole('region',{name:'Неразобранные задачи'});
  await tray.getByTestId('tray-T-inbox-0').getByRole('button',{name:'Разместить на доске'}).click();
  await expect(page.getByTestId('task-T-inbox-0')).toHaveCount(1);
  await expect.poll(()=>state.layouts['T-inbox-0']?.x).toBeDefined();
  const data=await page.evaluateHandle(()=>new DataTransfer());
  await tray.getByTestId('tray-T-inbox-1').dispatchEvent('dragstart',{dataTransfer:data});
  const rect=(await page.getByTestId('board-surface').boundingBox())!;
  await page.getByTestId('board-surface').dispatchEvent('drop',{dataTransfer:data,clientX:rect.x+400,clientY:rect.y+300});
  await expect(page.getByTestId('task-T-inbox-1')).toHaveCount(1);
  await expect.poll(()=>state.layouts['T-inbox-1']?.x).toBeDefined();
  expect(writes.every(p=>p.startsWith('/api/layouts/')||p==='/api/settings')).toBe(true);
});

test('одна карточка серии сохраняет позицию после следующего повтора',async({page})=>{
  const {state}=await openBoard(page);
  await expect(page.locator('.react-flow__node-task')).toHaveCount(2);
  await expect(page.getByTestId('task-T-repeat-0').getByText('↻ Повторяется')).toBeVisible();
  const card=page.getByTestId('task-T-repeat-0');const rect=(await card.boundingBox())!;
  await page.mouse.move(rect.x+50,rect.y+35);await page.mouse.down();await page.mouse.move(rect.x+110,rect.y+70,{steps:6});await page.mouse.up();
  await expect.poll(()=>state.layouts['T-series'].x).not.toBe(650);
  const saved={...state.layouts['T-series']};state.tasks.find(t=>t.id==='T-repeat-0').checked=1;
  await expect(page.getByTestId('task-T-repeat-1')).toBeVisible();
  const pos=await page.locator('.react-flow__node[data-id="T-repeat-1"]').evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return{x:m.m41,y:m.m42};});
  expect(pos.x).toBeCloseTo(saved.x);expect(pos.y).toBeCloseTo(saved.y);
});

test('оси оформлены блоками, подписи редактируются, координаты задач не сдвигаются',async({page})=>{
  const {state}=await openBoard(page);const before={...state.layouts['T-placed']};
  await expect(page.getByTestId('axis-question-x')).toHaveText('Если эту задачу сделать, то…');
  await expect(page.getByText('Ось X',{exact:true})).toHaveCount(0);await expect(page.getByText('Ось Y',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'Настройки доски'});
  await settings.getByLabel('Подпись справа',{exact:true}).fill('Моя подпись направления');
  await settings.getByRole('button',{name:'Сохранить настройки'}).click();
  await expect(settings.getByRole('status')).toHaveText('Настройки сохранены');
  await settings.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(page.locator('.axis-right')).toHaveText('Моя подпись направления');
  expect(state.layouts['T-placed']).toEqual(before);
  await page.screenshot({path:'/tmp/singboard-usability.png'});
});


test('размещение в квадрант автоматически расширяет матрицу и сохраняет другие карточки',async({page})=>{
  const {state,writes}=await openBoard(page);const before={...state.layouts['T-placed']};
  await page.getByRole('button',{name:/Неразобранное/}).click();
  const tray=page.getByRole('region',{name:'Неразобранные задачи'});
  await tray.getByLabel('Квадрант для размещения').selectOption('3');
  for(let i=0;i<8;i++)await tray.getByTestId(`tray-T-inbox-${i}`).getByRole('button',{name:'Разместить на доске'}).click();
  await expect.poll(()=>state.settings.matrixBounds.right).toBeGreaterThan(1100);
  await expect.poll(()=>state.layouts['T-inbox-7']?.x).toBeGreaterThan(550);
  for(let i=0;i<8;i++){expect(state.layouts[`T-inbox-${i}`].x).toBeGreaterThan(550);expect(state.layouts[`T-inbox-${i}`].y).toBeGreaterThan(450);}
  expect(state.layouts['T-placed']).toEqual(before);
  expect(state.settings.viewport.zoom).toBeCloseTo(.65);
  expect(writes.every(p=>p.startsWith('/api/layouts/')||p==='/api/settings')).toBe(true);
  const saved={...state.settings.matrixBounds};await page.reload();
  await expect(page.getByTestId('matrix')).toHaveCSS('width',`${saved.right-saved.left}px`);
});

test('ручная граница меняет размер, а приближение квадранта меняет только камеру',async({page})=>{
  const {state}=await openBoard(page);const task={...state.layouts['T-placed']};
  const handle=page.getByTestId('matrix-edge-right');await handle.focus();await handle.press('ArrowRight');
  await expect.poll(()=>state.settings.matrixBounds.right).toBeGreaterThan(1100);
  const size={...state.settings.matrixBounds};
  expect(state.settings.viewport.zoom).toBeCloseTo(.65);
  await page.getByLabel('Приблизить квадрант',{exact:true}).selectOption('0');
  await expect.poll(()=>state.settings.viewport.zoom).not.toBe(.65);
  expect(state.settings.matrixBounds).toEqual(size);expect(state.layouts['T-placed']).toEqual(task);
  await page.getByRole('button',{name:'Подогнать границы',exact:true}).click();
  await expect.poll(()=>state.settings.matrixBounds.right).toBe(1100);
});

test('подписи не перезаписывают размер матрицы, изменённый при открытых настройках',async({page})=>{
  const {state}=await openBoard(page);
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  state.settings.matrixBounds={left:-560,top:-320,right:2220,bottom:1540};
  await page.waitForTimeout(2700);
  const settings=page.getByRole('dialog',{name:'Настройки доски'});
  await settings.getByLabel('Подпись справа',{exact:true}).fill('Сохранить без сжатия');
  await settings.getByRole('button',{name:'Сохранить настройки'}).click();
  await expect(settings.getByRole('status')).toHaveText('Настройки сохранены');
  expect(state.settings.matrixBounds.right).toBe(2220);expect(state.settings.matrixBounds.left).toBe(-560);
});


test('все задачи открывает общий список с неразобранными, скрытыми и выполненными',async({page})=>{
  const {writes}=await openBoard(page,state=>{
    state.tasks.push({id:'T-hidden',title:'Скрытая задача',tags:[],checked:0},{id:'T-done',title:'Готовая задача',tags:[],checked:1});
    state.layouts['T-hidden']={x:300,y:300,width:250,height:100,hidden:true};
  });
  await page.getByPlaceholder('Найти задачу…').fill('Нет совпадений');
  await page.getByRole('button',{name:/^Все задачи/}).click();
  const tray=page.getByRole('region',{name:'Все задачи',exact:true});
  await expect(tray).toBeVisible();
  await expect(page.getByPlaceholder('Найти задачу…')).toHaveValue('');
  await expect(tray.getByText('205 задач',{exact:true})).toBeVisible();
  await expect(tray.locator('.tray-task')).toHaveCount(20);
  await expect(tray.getByTestId('tray-T-placed').getByText('На матрице',{exact:true})).toBeVisible();
  await expect(tray.getByTestId('tray-T-inbox-0').getByText('Неразобранное',{exact:true})).toBeVisible();
  await tray.getByRole('button',{name:'Следующая страница задач'}).click();
  await expect(tray.getByTestId('tray-T-inbox-19')).toBeVisible();
  await tray.getByLabel('Поиск в списке задач').fill('Скрытая задача');
  await expect(tray.getByTestId('tray-T-hidden').getByText('Скрыта с доски')).toBeVisible();
  await tray.getByRole('button',{name:/Скрытая задача/}).click();
  const editor=page.getByRole('complementary',{name:'Свойства задачи'});
  await expect(editor.getByLabel('Название задачи',{exact:true})).toHaveValue('Скрытая задача');
  await editor.getByLabel('Закрыть свойства',{exact:true}).click();
  await tray.getByLabel('Поиск в списке задач').fill('Готовая задача');
  await expect(tray.locator('.tray-task')).toHaveCount(0);
  await page.getByLabel('Показывать выполненные',{exact:true}).check();
  await expect(tray.getByTestId('tray-T-done')).toBeVisible();
  await expect(tray.getByText('206 задач',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Неразобранное/}).click();
  const inbox=page.getByRole('region',{name:'Неразобранные задачи'});
  await expect(inbox.getByLabel('Поиск в списке задач')).toHaveValue('');
  await inbox.getByLabel('Поиск в списке задач').fill('');
  await expect(inbox.getByTestId('tray-T-inbox-0')).toBeVisible();
  await expect(inbox.getByTestId('tray-T-placed')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('общий список приближает размещённые карточки и возвращает скрытые без перемещения',async({page})=>{
  const {state,writes}=await openBoard(page,state=>{
    state.tasks.push({id:'T-hidden',title:'Скрытая задача',tags:[],checked:0});
    state.layouts['T-hidden']={x:300,y:300,width:250,height:100,hidden:true};
  });
  const placed={...state.layouts['T-placed']};const hidden={...state.layouts['T-hidden']};
  await page.getByRole('button',{name:/^Все задачи/}).click();
  const tray=page.getByRole('region',{name:'Все задачи',exact:true});
  await expect(tray.getByTestId('tray-T-placed')).toHaveAttribute('draggable','false');
  await tray.getByTestId('tray-T-placed').getByRole('button',{name:'Показать на матрице'}).click();
  await expect(tray).toHaveCount(0);
  await expect.poll(()=>state.settings.viewport.zoom).toBe(1);
  expect(state.layouts['T-placed']).toEqual(placed);
  expect(writes).toEqual(['/api/settings']);
  await page.getByRole('button',{name:/^Все задачи/}).click();
  await tray.getByLabel('Поиск в списке задач').fill('Скрытая задача');
  await tray.getByTestId('tray-T-hidden').getByRole('button',{name:'Вернуть карточку'}).click();
  await expect.poll(()=>state.layouts['T-hidden'].hidden).toBe(false);
  expect(state.layouts['T-hidden']).toEqual({...hidden,hidden:false});
  await tray.getByLabel('Поиск в списке задач').fill('Входящая задача 000');
  await expect(tray.getByTestId('tray-T-inbox-0')).toHaveAttribute('draggable','true');
  await tray.getByTestId('tray-T-inbox-0').getByRole('button',{name:'Разместить на доске'}).click();
  await expect.poll(()=>state.layouts['T-inbox-0']?.x).toBeDefined();
  await expect(tray.getByTestId('tray-T-inbox-0').getByRole('button',{name:'Показать на матрице'})).toBeVisible();
  expect(state.layouts['T-placed']).toEqual(placed);
  expect(writes.every(p=>p.startsWith('/api/layouts/')||p==='/api/settings')).toBe(true);
});
