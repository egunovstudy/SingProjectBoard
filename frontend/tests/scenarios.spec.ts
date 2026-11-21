import {test,expect} from '@playwright/test';

async function openScenarios(page:any, configure: (state:any)=>void = ()=>{}) {
  const state:any={mode:'demo',tasks:[{id:'task-custom',title:'Сделать резервную копию',tags:['goal','fear','ordinary'],checked:0}],
    tags:[{id:'root',title:'Проекты доски'},{id:'goals',title:'Цели',parent:'root'},{id:'fears',title:'Опасения',parent:'root'},
      {id:'goal',title:'Могу восстановить файлы',parent:'goals'},{id:'fear',title:'Теряю архив',parent:'fears'},{id:'ordinary',title:'Обычный тег'}],
    projects:[{id:'goal',title:'Могу восстановить файлы',parent:'goals',scenarioType:'goal'},
      {id:'fear',title:'Теряю архив',parent:'fears',scenarioType:'fear'}],nativeProjects:[],operations:[],sync:{running:false,lastSuccess:Date.now(),error:''},
    layouts:{'task-custom':{x:80,y:120,width:250,height:100}},
    settings:{rootTagId:'root',goalTagId:'goals',fearTagId:'fears',timezone:'Europe/Moscow',syncSeconds:60,
      xAxis:'Если сделать',yAxis:'Если не сделать',axisLabels:{left:'Слева',right:'Справа',top:'Сверху',bottom:'Снизу'},
      quadrants:['I','II','III','IV'],projectIds:[],matrixBounds:{left:0,top:0,right:1100,bottom:900},viewport:{x:150,y:140,zoom:0.65}}};
  configure(state);
  const writes:any[]=[];
  await page.route('**/api/**',async(route:any)=>{
    const req=route.request();const path=new URL(req.url()).pathname;const method=req.method();
    if(method!=='GET')writes.push({path,data:req.postDataJSON()});
    if(path==='/api/board')return route.fulfill({json:state});
    if(path==='/api/settings'){Object.assign(state.settings,req.postDataJSON());return route.fulfill({json:state.settings});}
    if(path.startsWith('/api/layouts/')){const id=decodeURIComponent(path.slice('/api/layouts/'.length));state.layouts[id]={...state.layouts[id],...req.postDataJSON()};}
    if(path==='/api/tasks/task-custom/tags'){
      const {tagId,add}=req.postDataJSON();const task=state.tasks[0];
      task.tags=add?[...new Set([...task.tags,tagId])]:task.tags.filter((id:string)=>id!==tagId);
    }
    if(path==='/api/tags'){
      const {title,scenarioType}=req.postDataJSON();const tag={id:`new-scenario-${scenarioType}`,title,parent:scenarioType==='goal'?'goals':'fears',scenarioType};
      state.projects.push(tag);state.tags.push(tag);
    }
    return route.fulfill({json:{}});
  });
  await page.goto('/');await expect(page.getByTestId('task-task-custom')).toBeVisible();
  return {state,writes};
}

test('сценарии по сторонам матрицы, зелёный наконечник и красная точка; оба мотива одной задачи',async({page},testInfo)=>{
  const {state,writes}=await openScenarios(page);
  const before=structuredClone(state.layouts['task-custom']);
  await page.getByRole('button',{name:'Показать всю доску',exact:true}).click();
  await page.waitForTimeout(350); // Finish the fit-view animation before comparing rectangles.
  const matrix=(await page.getByTestId('matrix').boundingBox())!;
  const goal=(await page.getByTestId('scenario-goal').boundingBox())!;
  const fear=(await page.getByTestId('scenario-fear').boundingBox())!;
  expect(goal.x).toBeGreaterThan(matrix.x+matrix.width);
  expect(fear.y).toBeGreaterThan(matrix.y+matrix.height);
  const goalPath=page.locator('.scenario-link.goal .react-flow__edge-path');
  const fearPath=page.locator('.scenario-link.fear .react-flow__edge-path');
  await expect(goalPath).toHaveCSS('stroke','rgb(41, 166, 106)');
  await expect(goalPath).toHaveAttribute('marker-end',/scenario-goal-arrow/);
  await expect(fearPath).toHaveCSS('stroke','rgb(239, 65, 75)');
  await expect(fearPath).toHaveAttribute('marker-end',/scenario-fear-dot/);
  expect(writes.filter((w:any)=>w.path==='/api/tags')).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('scenarios.png')});
  await page.getByTestId('task-task-custom').click();
  const editor=page.getByRole('complementary',{name:'Свойства задачи'});
  await expect(editor.getByLabel('Могу восстановить файлы',{exact:true})).toBeChecked();
  await expect(editor.getByLabel('Теряю архив',{exact:true})).toBeChecked();
  await editor.getByLabel('Теряю архив',{exact:true}).uncheck();
  await expect.poll(()=>state.tasks[0].tags.includes('fear')).toBe(false);
  await editor.getByLabel('Теряю архив',{exact:true}).check();
  await expect.poll(()=>state.tasks[0].tags.includes('fear')).toBe(true);
  expect(state.tasks[0].tags).toContain('ordinary');
  expect(state.layouts['task-custom']).toEqual(before);
  await editor.getByLabel('Закрыть свойства').click();
  const node=page.getByTestId('task-task-custom');const rect=(await node.boundingBox())!;
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  await page.mouse.move(matrix.x+matrix.width*.7,matrix.y+matrix.height*.7,{steps:12});await page.mouse.up();
  await expect.poll(()=>state.layouts['task-custom'].y).toBeGreaterThan(450);
  await expect.poll(()=>state.layouts['task-custom'].x).toBeGreaterThan(550);
  expect(state.tasks[0].tags).toEqual(expect.arrayContaining(['goal','fear','ordinary']));
});

test('создание опасения отправляет тип и естественное название; настройки хранят ID веток',async({page})=>{
  const {state,writes}=await openScenarios(page);
  await page.getByLabel('Тип нового сценария').selectOption('fear');
  await page.getByLabel('Название нового сценария').fill('Пропускаю важное событие');
  await page.getByRole('button',{name:'Создать сценарий',exact:true}).click();
  await expect(page.getByTestId('scenario-new-scenario-fear')).toContainText('Пропускаю важное событие');
  expect(writes.find((w:any)=>w.path==='/api/tags').data).toMatchObject({title:'Пропускаю важное событие',scenarioType:'fear'});
  expect(state.projects.find((p:any)=>p.id==='new-scenario-fear').parent).toBe('fears');
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await expect(page.getByLabel('Ветка целей',{exact:true})).toHaveValue('goals');
  await expect(page.getByLabel('Ветка опасений',{exact:true})).toHaveValue('fears');
});

for (const width of [1024, 1440, 1920]) {
  test(`поле сценария доступно при ширине ${width}; цель по Enter, опасение кнопкой`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:960});
    const {writes}=await openScenarios(page);
    const form=page.getByRole('form',{name:'Новый сценарий'});
    const input=form.getByLabel('Название нового сценария');
    const button=form.getByRole('button',{name:'Создать сценарий',exact:true});
    const bounds=(await form.boundingBox())!;
    const field=(await input.boundingBox())!;
    const sidebar=(await page.locator('.sidebar').boundingBox())!;
    expect(field.width).toBeGreaterThan(120);
    expect(field.x).toBeGreaterThanOrEqual(sidebar.x);
    expect(field.x+field.width).toBeLessThanOrEqual(sidebar.x+sidebar.width);
    expect(field.width).toBeCloseTo(bounds.width,0);
    await expect(input).toHaveAttribute('placeholder','Название цели');
    await expect(button).toBeDisabled();
    await input.click();
    await page.keyboard.type('  Достигаю результата  ');
    await expect(button).toBeEnabled();
    await input.press('Enter');
    await expect(page.getByTestId('scenario-new-scenario-goal')).toContainText('Достигаю результата');
    await expect(input).toHaveValue('');
    await expect(form.getByRole('status')).toContainText('Создание в очереди');
    await form.getByLabel('Тип нового сценария').selectOption('fear');
    await expect(input).toHaveAttribute('placeholder','Название опасения');
    await input.fill('Теряю результат');
    await expect(button).toHaveText('Добавить опасение');
    await button.click();
    await expect(page.getByTestId('scenario-new-scenario-fear')).toContainText('Теряю результат');
    expect(writes.filter((w:any)=>w.path==='/api/tags').map((w:any)=>({title:w.data.title,type:w.data.scenarioType})))
      .toEqual([{title:'Достигаю результата',type:'goal'},{title:'Теряю результат',type:'fear'}]);
    await page.screenshot({path:testInfo.outputPath(`scenario-form-${width}.png`)});
  });
}

test('ненастроенная или недоступная ветка объясняет блокировку; Enter не отправляет запрос',async({page})=>{
  const {writes}=await openScenarios(page,state=>{
    state.settings.goalTagId='';
    state.tags.find((t:any)=>t.id==='fears').missing=true;
  });
  const form=page.getByRole('form',{name:'Новый сценарий'});
  const input=form.getByLabel('Название нового сценария');
  await input.fill('Мой сценарий');
  await expect(form.getByText('Выберите или создайте ветку «Цели» в настройках.')).toBeVisible();
  await expect(form.getByRole('button',{name:'Создать сценарий',exact:true})).toBeDisabled();
  await input.press('Enter');
  // Exercise the submit guard too: a disabled submit button alone is insufficient.
  await form.evaluate((el:any)=>el.requestSubmit());
  await form.getByLabel('Тип нового сценария').selectOption('fear');
  await expect(form.getByText('Выберите или создайте ветку «Опасения» в настройках.')).toBeVisible();
  await form.evaluate((el:any)=>el.requestSubmit());
  expect(writes.filter((w:any)=>w.path==='/api/tags')).toEqual([]);
  await form.getByRole('button',{name:'Открыть настройки →'}).click();
  await expect(page.getByRole('dialog',{name:'Настройки доски'})).toBeVisible();
});

test('ошибка сохраняет название и requestId, повторная отправка блокируется до ответа',async({page})=>{
  await openScenarios(page);
  const requests:any[]=[];
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/tags',async route=>{
    requests.push(route.request().postDataJSON());
    if(requests.length===1)return route.fulfill({status:503,json:{error:'Сервер временно недоступен'}});
    await held;
    return route.fulfill({json:{operationId:'queued',status:'PENDING'}});
  });
  const form=page.getByRole('form',{name:'Новый сценарий'});
  const input=form.getByLabel('Название нового сценария');
  const button=form.getByRole('button',{name:'Создать сценарий',exact:true});
  await input.fill('Сохранённый черновик');
  await button.click();
  await expect(form.getByRole('alert')).toHaveText('Сервер временно недоступен');
  await expect(input).toHaveValue('Сохранённый черновик');
  await button.click();
  await expect(button).toBeDisabled();
  await expect(input).toBeDisabled();
  await form.evaluate((el:any)=>{el.requestSubmit();el.requestSubmit();});
  await expect.poll(()=>requests.length).toBe(2);
  expect(requests[1].requestId).toBe(requests[0].requestId);
  release();
  await expect(input).toHaveValue('');
  await expect(form.getByRole('status')).toContainText('Создание в очереди');
  expect(requests).toHaveLength(2);
});
