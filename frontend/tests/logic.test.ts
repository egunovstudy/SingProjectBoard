import test from 'node:test';
import assert from 'node:assert/strict';
import {noteText, simpleNote, readOnly, recurring} from '../src/types.ts';

test('Quill Delta displays Unicode and embedded content without interpreting HTML',()=>{
  assert.equal(noteText('[{"insert":"Привет "},{"insert":{"image":"https://example.invalid/a"}},{"insert":"\\n"}]'),'Привет [вложение]');
  assert.equal(noteText('[{"insert":"<script>alert(1)</script>\\n"}]'),'<script>alert(1)</script>');
});
test('formatted Delta is distinguished from plain text so unchanged notes are preserved',()=>{
  assert.equal(simpleNote('[{"insert":"Текст\\n"}]'),true);
  assert.equal(simpleNote('[{"insert":"Текст","attributes":{"bold":true}},{"insert":"\\n"}]'),false);
  assert.equal(simpleNote('[{"insert":{"image":"x"}}]'),false);
});
test('unknown and malformed descriptions stay available for inspection',()=>{
  assert.equal(simpleNote('legacy description'),false);
  assert.equal(noteText('legacy description'),'legacy description');
  assert.equal(noteText('{"ops":[]}'),'{"ops":[]}');
  assert.equal(noteText(''), '');
});
test('empty notes can be edited as plain text',()=>{
  assert.equal(simpleNote(undefined),true);assert.equal(simpleNote(''),true);assert.equal(simpleNote('[]'),true);
});
test('recurring instances and generators are read only',()=>{
  const task={id:'T-1',title:'Задача'};
  assert.equal(recurring({...task,recurrence:{}}),false);
  assert.equal(readOnly({...task,recurrence:{rule:'daily'}}),true);
  assert.equal(readOnly({...task,recurrenceGeneratorId:'T-parent'}),true);
});
test('encrypted and unavailable tasks cannot be edited',()=>{
  const task={id:'T-1',title:'Задача'};
  assert.equal(readOnly(task),false);
  for(const patch of [{crypted:'encrypted'},{missing:true},{removed:true},{deleteDate:'2026-11-11'}])assert.equal(readOnly({...task,...patch}),true);
});

// Regression coverage for the canvas and recurring-series presentation.
import {presentTasks, horizontalWheelDelta, isPlaced, freePosition} from '../src/boardModel.ts';
const wheel={deltaX:0,deltaY:0,deltaMode:0,shiftKey:false,ctrlKey:false,metaKey:false};
test('thumb wheel pans horizontally in either direction without changing zoom',()=>{
  assert.deepEqual(horizontalWheelDelta({...wheel,deltaX:120},1000,700),{x:120,y:0});
  assert.deepEqual(horizontalWheelDelta({...wheel,deltaX:-90,deltaY:2},1000,700),{x:-90,y:2});
});
test('ordinary wheel and pinch remain zoom gestures',()=>{
  assert.equal(horizontalWheelDelta({...wheel,deltaY:120},1000,700),null);
  assert.equal(horizontalWheelDelta({...wheel,deltaX:100,ctrlKey:true},1000,700),null);
  assert.equal(horizontalWheelDelta({...wheel,deltaX:100,metaKey:true},1000,700),null);
});
test('line/page wheels and shift scrolling use screen-pixel distances',()=>{
  assert.deepEqual(horizontalWheelDelta({...wheel,deltaX:3,deltaMode:1},1000,700),{x:48,y:0});
  assert.deepEqual(horizontalWheelDelta({...wheel,deltaX:1,deltaMode:2},1000,700),{x:1000,y:0});
  assert.deepEqual(horizontalWheelDelta({...wheel,deltaY:80,shiftKey:true},1000,700),{x:80,y:0});
});
test('a series shows the earliest open instance and links from its template',()=>{
  const tasks=[{id:'T-root',title:'Платёж',start:'2025-01-01',recurrence:{rule:'monthly'},tags:['A-fear']},
    {id:'T-jan',title:'Платёж',checked:1,start:'2026-01-01',recurrenceGeneratorId:'T-root'},
    {id:'T-mar',title:'Платёж',start:'2026-03-01',recurrenceGeneratorId:'T-root'},
    {id:'T-feb',title:'Платёж',start:'2026-02-01',recurrenceGeneratorId:'T-root',tags:['A-ordinary']}];
  const [view]=presentTasks(tasks,{});
  assert.equal(view.id,'T-feb');assert.equal(view.layoutId,'T-root');assert.equal(view.occurrenceCount,4);assert.equal(recurring(view),true);
  assert.deepEqual(view.scenarioTags,['A-fear']);assert.deepEqual(view.tags,['A-ordinary']);assert.equal(view.canEditScenarios,true);
});
test('same-title independent tasks and different recurring series are not collapsed',()=>{
  const tasks=[{id:'T-1',title:'Платёж'}, {id:'T-2',title:'Платёж'},
    {id:'T-3',title:'Платёж',recurrenceGeneratorId:'T-a'}, {id:'T-4',title:'Платёж',recurrenceGeneratorId:'T-b'}];
  assert.equal(presentTasks(tasks,{}).length,4);
});
test('a grouped series keeps legacy coordinates and canonical layout across rollover',()=>{
  const tasks=[{id:'T-a',title:'Задача',start:'2026-01-01',recurrenceGeneratorId:'T-root'},
    {id:'T-b',title:'Задача',start:'2026-02-01',recurrenceGeneratorId:'T-root'}];
  const legacy={'T-a':{x:123,y:456,width:330,height:180}};
  assert.deepEqual(presentTasks(tasks,legacy)[0].layout,legacy['T-a']);
  const canonical={'T-root':{x:222,y:333,width:300,height:150,hidden:true}};
  const next=presentTasks([{...tasks[0],checked:1},tasks[1]],canonical)[0];
  assert.equal(next.id,'T-b');assert.deepEqual(next.layout,canonical['T-root']);
  assert.equal(canonical['T-root'].hidden,true);
});
test('missing/removed tasks do not hide a live instance and projection does not alter source data',()=>{
  const tasks=[{id:'T-a',title:'Задача',missing:true,recurrenceGeneratorId:'T-root'},
    {id:'T-b',title:'Задача',recurrenceGeneratorId:'T-root',tags:['A-goal']}, {id:'T-c',title:'Архив',deleteDate:'2026-11-11'}];
  const before=JSON.stringify(tasks);const views=presentTasks(tasks,{});
  assert.equal(views.length,1);assert.equal(views[0].id,'T-b');assert.equal(JSON.stringify(tasks),before);
  assert.deepEqual(views[0].scenarioTags,['A-goal']);assert.equal(views[0].canEditScenarios,false);
});
test('unsorted tasks have no synthetic canvas position, placement avoids existing cards',()=>{
  const [view]=presentTasks([{id:'T-new',title:'Новая задача'}],{});
  assert.equal(isPlaced(view.layout),false);assert.equal(isPlaced({x:10}),false);
  const position=freePosition({x:350,y:300},[{x:225,y:250,width:250,height:100}]);
  assert.equal(isPlaced(position),true);assert.notDeepEqual(position,{x:225,y:250,width:250,height:100});
});

import {AXIS,DEFAULT_MATRIX,expandMatrix,fitMatrix,resizeMatrix,quadrantRect,matrixFrame,placeInQuadrant,validMatrix,sameMatrix} from '../src/matrixGeometry.ts';
test('matrix expands toward cards on all four outer sides without mutating coordinates',()=>{
  const cards=[{x:-500,y:200,width:250,height:100},{x:2400,y:300,width:300,height:150},
    {x:700,y:-600,width:250,height:100},{x:200,y:1900,width:250,height:100}];
  const original=JSON.stringify(cards);
  const b=expandMatrix(DEFAULT_MATRIX,cards);
  assert.ok(b.left<-500&&b.right>2700&&b.top<-600&&b.bottom>2000);
  assert.equal(JSON.stringify(cards),original);assert.deepEqual(AXIS,{x:550,y:450});
  for(let i=0;i<4;i++){const r=quadrantRect(b,i);assert.equal(i%2===0?r.x+r.width:r.x,AXIS.x);assert.equal(i<2?r.y+r.height:r.y,AXIS.y);}
});
test('auto growth keeps its size after cards are hidden or removed; fitting is explicit',()=>{
  const b=expandMatrix(DEFAULT_MATRIX,[{x:3000,y:1500}]);
  assert.deepEqual(expandMatrix(b,[]),b);
  assert.deepEqual(expandMatrix(b,[{x:3000,y:1500,hidden:true}]),b);
  assert.deepEqual(fitMatrix([]),DEFAULT_MATRIX);
  assert.equal(sameMatrix(b,DEFAULT_MATRIX),false);
});
test('edge approach adds reserve once rather than expanding on every poll',()=>{
  const card={x:1000,y:300,width:250,height:100};
  const b=expandMatrix(DEFAULT_MATRIX,[card]);
  assert.ok(b.right>=card.x+card.width+250);
  assert.deepEqual(expandMatrix(b,[card]),b);
  assert.deepEqual(expandMatrix(DEFAULT_MATRIX,[{x:400,y:300}]),DEFAULT_MATRIX);
});
test('manual resize keeps axes fixed, minimum dimensions and cards protected',()=>{
  const large={left:-800,top:-600,right:2500,bottom:1800};
  assert.equal(resizeMatrix(large,'right',3500,[]).right,3500);
  const shrunk=resizeMatrix(large,'right',900,[{x:2100,y:600,width:300,height:100}]);
  assert.ok(shrunk.right>2400);assert.equal(shrunk.left,large.left);assert.equal(shrunk.top,large.top);
  assert.equal(resizeMatrix(large,'left',300,[]).left,0);
  assert.equal(resizeMatrix(large,'bottom',500,[]).bottom,900);
});
test('matrix frame includes annotations and keeps the original world-coordinate origin',()=>{
  const b={left:-500,top:-300,right:1900,bottom:1400};const frame=matrixFrame(b);
  assert.equal(frame.position.x+180,b.left);assert.equal(frame.position.y+164,b.top);
  assert.equal(frame.width,2580);assert.equal(frame.height,1864);
});
test('quadrant placement handles large cards and never overlaps existing cards',()=>{
  for(let q=0;q<4;q++){
    const cards:any[]=[];
    for(let i=0;i<20;i++){
      const next=placeInQuadrant(q,DEFAULT_MATRIX,cards,{width:i%3===0?330:250,height:i%4===0?160:100});
      assert.ok(q%2===0?next.x+next.width<AXIS.x:next.x>AXIS.x);
      assert.ok(q<2?next.y+next.height<AXIS.y:next.y>AXIS.y);
      for(const old of cards)assert.ok(next.x+next.width<=old.x||old.x+old.width<=next.x||next.y+next.height<=old.y||old.y+old.height<=next.y);
      cards.push(next);
    }
    const b=expandMatrix(DEFAULT_MATRIX,cards);
    for(const card of cards)assert.ok(card.x>=b.left&&card.y>=b.top&&card.x+card.width<=b.right&&card.y+card.height<=b.bottom);
  }
});
test('a full quadrant finds a new outward slot without rearranging existing tasks',()=>{
  const occupied:any[]=[];for(let i=0;i<10;i++)occupied.push(placeInQuadrant(3,DEFAULT_MATRIX,occupied));
  const before=JSON.stringify(occupied);const bounds=expandMatrix(DEFAULT_MATRIX,occupied);
  assert.ok(bounds.right>DEFAULT_MATRIX.right||bounds.bottom>DEFAULT_MATRIX.bottom);
  assert.equal(JSON.stringify(occupied),before);
  const at=placeInQuadrant(0,DEFAULT_MATRIX,[{x:276,y:326,hidden:true}]);assert.equal(at.x,276);assert.equal(at.y,326);
});
test('malformed persisted dimensions are rejected before restoring a draft',()=>{
  assert.equal(validMatrix(DEFAULT_MATRIX),true);
  for(const b of [null,{}, {...DEFAULT_MATRIX,left:1},{...DEFAULT_MATRIX,right:Infinity},{...DEFAULT_MATRIX,top:-1e10},{...DEFAULT_MATRIX,left:'0'},{...DEFAULT_MATRIX,extra:1}])assert.equal(validMatrix(b),false);
  assert.throws(()=>placeInQuadrant(4,DEFAULT_MATRIX,[]));
});
test('repeated quadrant placement stays compact as reserved space expands',()=>{
  let bounds={...DEFAULT_MATRIX};const cards:any[]=[];
  for(let i=0;i<20;i++){cards.push(placeInQuadrant(3,bounds,cards));bounds=expandMatrix(bounds,cards);}
  assert.ok(new Set(cards.map(c=>c.x)).size>=3);assert.ok(new Set(cards.map(c=>c.y)).size>=3);
  assert.ok(bounds.right<3000&&bounds.bottom<2200);
});

import {scenarioPositions,activeScenarios,scenarioTree,scenarioBranch,scenarioNodeIds,chainMarkerCandidates} from '../src/scenarios.ts';
import {taskChains,canPositionStep} from '../src/chains.ts';
import type {Scenario} from '../src/types.ts';
const scenarios:Scenario[] = [
  {id:'goal',title:'Желаемый результат',scenarioType:'goal'},
  {id:'fear',title:'Нежелательная ситуация',scenarioType:'fear'},
  {id:'legacy',title:'Старый тег',scenarioType:'unclassified'},
];
test('only unavailable tags are hidden; empty live scenarios of every type remain',()=>{
  const tags:Scenario[]=[...scenarios,
    {id:'deleted',title:'Удалённый тег',scenarioType:'goal',missing:true},
    {id:'removed',title:'Удалён',scenarioType:'fear',removed:true},
    {id:'trash',title:'В корзине',scenarioType:'unclassified',deleteDate:'2026-11-17'}];
  const before=structuredClone(tags);
  assert.deepEqual(activeScenarios(tags),scenarios);
  assert.deepEqual(tags,before);
  assert.deepEqual(activeScenarios([]),[]);
});
test('restoring an unavailable tag returns its saved position without changing the layout',()=>{
  const layouts={goal:{x:1400,y:370,width:230,height:104}};
  const before=structuredClone(layouts);
  const unavailable=scenarios.map(tag=>({...tag,missing:true}));
  assert.deepEqual(scenarioPositions(activeScenarios(unavailable),layouts,DEFAULT_MATRIX),{});
  const restored=scenarioPositions(activeScenarios(scenarios),layouts,DEFAULT_MATRIX);
  assert.deepEqual(restored.goal,{x:1400,y:370});
  assert.deepEqual(layouts,before);
});
test('scenario sides follow growing borders without rewriting stored layouts',()=>{
  const layouts={goal:{x:1200,y:170},fear:{x:180,y:300},legacy:{hidden:true}};
  const before=structuredClone(layouts);
  const matrix={left:-400,top:-200,right:2200,bottom:1700};
  const positions=scenarioPositions(scenarios,layouts,matrix);
  assert.ok(positions.goal.x>matrix.right);
  assert.equal(positions.goal.y,170);
  assert.ok(positions.fear.y>matrix.bottom);
  assert.equal(positions.fear.x,180);
  assert.equal(positions.legacy,undefined);
  assert.deepEqual(layouts,before);
});
test('legacy positions and multiple new scenarios do not stack after changing type',()=>{
  const many:Scenario[]=Array.from({length:8},(_,i)=>({id:`fear-${i}`,title:'Опасение',scenarioType:'fear'}));
  const layouts=Object.fromEntries(many.map((s,i)=>[s.id,{x:1300,y:i*150}]));
  const positions=scenarioPositions([...many,...scenarios],layouts,DEFAULT_MATRIX);
  const all=Object.values(positions);
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
    assert.ok(Math.abs(all[i].x-all[j].x)>=250||Math.abs(all[i].y-all[j].y)>=124);
  }
  assert.ok(all.every(p=>p.x>DEFAULT_MATRIX.right||p.y>DEFAULT_MATRIX.bottom));
});

test('the viewed scenario covers its descendants and only their linked tasks', () => {
  const settings = {rootTagId:'root', goalTagId:'goals', fearTagId:'fears'};
  const tags = [
    {id:'root', title:'Орбита'},
    {id:'goals', parent:'root', title:'Цели'},
    {id:'fears', parent:'root', title:'Опасения'},
    {id:'move', parent:'goals', title:'Переехать'},
    {id:'sell', parent:'move', title:'Продать квартиру'},
    {id:'find', parent:'move', title:'Найти посёлок'},
    {id:'prepare', parent:'sell', title:'Подготовить документы'},
    {id:'other', parent:'goals', title:'Освоить навык'},
    {id:'risk', parent:'fears', title:'Не хватает средств'},
    {id:'risk-step', parent:'risk', title:'Затянуть продажу'},
    {id:'deleted', parent:'move', title:'Старый план', missing:true},
    {id:'orphan', parent:'deleted', title:'Ветка под удалённым тегом'},
    {id:'marker', title:'Цепочка'},
  ];
  const links = scenarioTree(tags, settings);
  const branch = scenarioBranch(links,'move');
  assert.deepEqual(branch,new Set(['move','sell','find','prepare']));
  assert.deepEqual(scenarioNodeIds(branch, [
    {id:'T-documents',scenarioTags:['prepare','other']},
    {id:'T-visit',scenarioTags:['find']},
    {id:'T-risk',scenarioTags:['risk']},
    {id:'T-unlinked',scenarioTags:[]},
  ]),new Set(['move','sell','find','prepare','T-documents','T-visit']));
  assert.deepEqual(scenarioBranch(links,'sell'),new Set(['sell','prepare']));
  assert.deepEqual(scenarioBranch(links,'risk'),new Set(['risk','risk-step']));
  assert.equal(links.find((link)=>link.child==='risk-step')?.type,'fear');
  assert.deepEqual(chainMarkerCandidates(tags,settings.rootTagId).map((tag)=>tag.id),['marker']);
});

test('only marked parents produce chains, including completed and unplaced steps in manual order', () => {
  const parent = {id:'T-chain',title:'Гитара',tags:['marker'],projectId:'p'};
  const last = {id:'T-last',title:'Просверлить',parent:parent.id,parentOrder:4,projectId:'p'};
  const first = {id:'T-first',title:'Примерить',parent:parent.id,parentOrder:1.5,projectId:'p',checked:1};
  const raw = [
    last, first, parent,
    {id:'T-else',title:'Другая задача',projectId:'p'},
    {id:'T-unrelated',title:'Другой проект',projectId:'other'},
    {id:'T-unmarked-child',title:'Обычная подзадача',parent:'T-else',parentOrder:1},
    {id:'T-removed',title:'Бывший шаг',parent:parent.id,missing:true},
    {id:'T-nested',title:'Вложенная группа',parent:last.id,tags:['marker']},
  ];
  const views = presentTasks(raw,{'T-first':{x:10,y:10}});
  const chains = taskChains(views,'marker');
  assert.deepEqual(chains.map((chain)=>chain.parent.id),[parent.id]);
  const [chain] = chains;
  assert.deepEqual(chain.steps.map((step)=>step.id),[first.id,last.id]);
  assert.equal(chain.steps.find((step)=>!step.checked)?.id,last.id);
  assert.equal(isPlaced(chain.steps[1].layout),false);
  assert.equal(canPositionStep(views.find((step)=>step.id==='T-else')!,chain,'marker'),true);
  assert.equal(canPositionStep(views.find((step)=>step.id==='T-unrelated')!,chain,'marker'),false);
  assert.equal(canPositionStep(views.find((step)=>step.id==='T-unmarked-child')!,chain,'marker'),false);
  const afterExternalMove = presentTasks(raw.map((task)=>task.id===last.id?{...task,parentOrder:0}:task),{});
  assert.deepEqual(taskChains(afterExternalMove,'marker')[0].steps.map((step)=>step.id),[last.id,first.id]);
});
