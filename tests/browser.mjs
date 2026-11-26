import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1440,height:960},locale:'ru-RU',acceptDownloads:true});
const p=await ctx.newPage();p.setDefaultTimeout(15000);
const errors=[],network=[],passed=[];
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))network.push(new URL(r.url()).origin);});
const saved=process.argv.includes('--record'),imageDir=saved?'docs/screenshots':'test-output/screenshots';
await mkdir(imageDir,{recursive:true});
const btn=(name)=>p.getByRole('button',{name,exact:true});
const ready=()=>p.locator('.shell[aria-busy=false]').waitFor();
const report=async(name,fn)=>{await fn();passed.push(name);console.log('✓ '+name);};
const modal=()=>p.locator('.dialog');
const demo=pathToFileURL(resolve('demo/index.html')).href;
try{
  await p.goto(demo);await ready();
  await report('Локальное демо, 14 виджетов, модальное окно и неизменный URL',async()=>{
    assert.equal(p.url(),demo);assert.equal(await p.locator('.widget').count(),14);
    assert.equal(await p.locator('dialog[open]').count(),1);
    assert.equal(await p.locator('.empty').count(),0);
    await p.screenshot({path:imageDir+'/dashboard.png'});
  });
  await report('Диаграмма → фильтр → исходные записи → сброс',async()=>{
    await p.locator('[data-widget=status] .viz path[role=button]').first().press('Enter');await btn('Показать исходные объекты').click();await ready();
    assert.ok(await p.locator('.records').isVisible());const count=await p.locator('.table-tools small').textContent();
    assert.ok(parseInt(count,10)>0&&!count.includes('1 000'));
    await btn('Сбросить фильтры').click();await ready();await btn('Дашборд').click();await ready();
    await p.locator('[data-widget=department] .viz [role=button]').first().click();await btn('Следующий уровень').click();await ready();
    assert.ok((await p.locator('[data-widget=department] .viz [role=button]').first().getAttribute('aria-label')).includes('Специалист'));
    await btn('Сбросить фильтры').click();await ready();
  });
  await report('Визуальный фильтр с вложенной группой AND/OR',async()=>{
    await btn('Настроить фильтры').click();await btn('Группа').click();await modal().locator('fieldset .group').getByRole('button',{name:'Условие',exact:true}).click();
    await modal().getByLabel('Поле условия').selectOption('status');await modal().getByLabel('Значение',{exact:true}).fill('Новая');
    await btn('Применить').click();await ready();assert.equal(await p.evaluate(()=>NSDAnalytics.exportConfig().filter.rules[0].rules[0].value),'Новая');
    await btn('Сбросить фильтры').click();await ready();
  });
  await report('Конструктор добавляет, настраивает, перемещает и удаляет виджет',async()=>{
    await btn('Добавить виджет').click();await modal().getByLabel('Название',{exact:true}).fill('Проверка виджета');
    await modal().getByLabel('Визуализация',{exact:true}).selectOption('column');
    await modal().getByLabel('Поле',{exact:true}).selectOption('priority');
    await modal().getByLabel('Ширина',{exact:true}).selectOption('2');
    await btn('Применить').click();await ready();
    const card=p.locator('.widget').filter({has:p.getByRole('heading',{name:'Проверка виджета',exact:true})});
    assert.ok((await card.getAttribute('class')).includes('wide'));
    await btn('Настройки · Проверка виджета').click();await btn('Переместить выше').click();await ready();
    assert.equal(await p.evaluate(()=>NSDAnalytics.exportConfig().widgets.at(-2).title),'Проверка виджета');
    await btn('Настройки · Проверка виджета').click();await btn('Удалить виджет').click();await ready();assert.equal(await card.count(),0);
  });
  await report('Многоуровневая сводная, настройка мер, итоги и drill-through',async()=>{
    await btn('Сводная').click();await ready();assert.ok(await p.locator('.pivot-table').isVisible());
    await p.screenshot({path:imageDir+'/pivot.png'});
    const rows=await p.locator('.pivot-table tbody tr').count();
    await p.locator('.pivot-table tbody button[aria-expanded=true]').first().click();
    assert.ok(await p.locator('.pivot-table tbody tr').count()<rows);
    await btn('Настроить сводную').click();await btn('Добавить показатель').click();await btn('Применить').click();await ready();
    assert.equal(await p.evaluate(()=>NSDAnalytics.exportConfig().pivot.measures.length),3);
    await p.locator('.cell-button').first().click();await ready();assert.ok(await p.locator('.records').isVisible());
    await btn('Сбросить фильтры').click();await ready();
  });
  await report('CSV/TSV/JSON/HTML, загрузка SVG и валидный PNG',async()=>{
    for(const format of ['CSV','TSV','JSON','HTML']){
      await btn('Экспорт').click();const dl=p.waitForEvent('download');await btn(format).click();
      const data=await readFile(await(await dl).path());
      if(format==='JSON')assert.equal(JSON.parse(data).length,1000);
      else if(format==='HTML')assert.ok(data.toString('utf8').includes('<table>'));
      else{assert.deepEqual([...data.subarray(0,3)],[239,187,191]);assert.ok(data.length>1000);}
    }
    await btn('Дашборд').click();await ready();
    for(const format of ['SVG','PNG']){
      await btn('Настройки · Статусы обращений').click();const dl=p.waitForEvent('download');await btn(format).click();
      const data=await readFile(await(await dl).path());
      if(format==='SVG')assert.ok(data.toString('utf8').includes('<svg'));
      else assert.equal(data.readUInt32BE(0),0x89504e47);
    }
  });
  await report('Сохранение только конфигурации; восстановление и импорт',async()=>{
    await btn('Шаблоны дашбордов').click();await btn('Сохранить в этом браузере').click();
    const s=await p.evaluate(()=>localStorage.getItem('nsd-analytics:v1:synthetic_tickets'));
    assert.ok(s&&!s.includes('demoCall$'));assert.equal(JSON.parse(s).version,1);
    await btn('Переключить тему').click();assert.ok(await p.locator('.shell.dark').isVisible());await p.screenshot({path:imageDir+'/dark.png'});
    await btn('Шаблоны дашбордов').click();await btn('Восстановить из браузера').click();await ready();
    assert.equal(await p.locator('.shell.dark').count(),0);
    await p.evaluate(async()=>{const cfg=NSDAnalytics.exportConfig();cfg.title='Импортировано';await NSDAnalytics.importConfig(JSON.stringify(cfg));});
    assert.ok(await p.getByRole('heading',{name:'Импортировано'}).isVisible());
  });
  await report('Копирование в Excel и печатный документ',async()=>{
    await p.evaluate(()=>{
      window.__studioTestClipboard='';
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async s=>{window.__studioTestClipboard=s;}}});
    });
    await btn('Экспорт').click();await btn('Копировать для Excel').click();
    await p.waitForFunction(()=>window.__studioTestClipboard.includes('demoCall$1000'));
    assert.ok((await p.evaluate(()=>window.__studioTestClipboard)).includes('\t'));
    await p.addInitScript(()=>{
      window.print=()=>{
        parent.__studioTestPrint={sections:document.querySelectorAll('section').length,title:document.title};
        window.dispatchEvent(new Event('afterprint'));
      };
    });
    await btn('Экспорт').click();await btn('Печать отчёта').click();
    await p.waitForFunction(()=>window.__studioTestPrint?.sections===14);
    assert.equal(await p.evaluate(()=>window.__studioTestPrint.title),'Импортировано');
  });
  await report('Все 18 представлений и пустые состояния',async()=>{
    const statuses=await p.evaluate(async()=>{
      const types=['bar','column','pie','donut','line','stacked','area','heatmap','scatter','histogram','treemap','funnel','kpi','pareto','box','gauge','pivot','table'];
      const data=Array.from({length:50},(_,i)=>({a:'A'+i%3,b:'B'+i%2,x:i,y:i*i}));
      await NSDAnalytics.open(data,{widgets:types.map(type=>({id:type,title:type,type,dims:['a','b'],x:'x',y:'y'}))});
      const root=document.querySelector('[data-nsd-analytics]').shadowRoot;
      return [...root.querySelectorAll('.widget')].map(e=>[e.dataset.widget,!!e.querySelector('.viz,.kpi-body strong,.records,.pivot-table'),e.querySelector('.empty')?.textContent]);
    });
    assert.equal(statuses.length,18);assert.ok(statuses.every(x=>x[1]&&!x[2]),JSON.stringify(statuses));
    await p.evaluate(()=>NSDAnalytics.open([{n:-3}],{widgets:[{type:'pie',measure:{op:'sum',field:'n'}}]}));
    assert.match(await p.locator('.empty').textContent(),/неотрицательные/);
  });
  await report('Разметка остаётся текстом, защищённый импорт сохраняет состояние',async()=>{
    await p.evaluate(()=>NSDAnalytics.open([{uuid:'demo$1',title:'<b data-probe="text">Пример</b>',url:'javascript:void(0)',s:'x'}],{widgets:[{type:'table'}]}));
    assert.equal(await p.locator('[data-probe]').count(),0);assert.ok((await p.locator('.records').textContent()).includes('<b'));
    await p.locator('.records tbody tr[tabindex]').first().click();assert.equal(await btn('Открыть карточку').count(),0);await btn('Закрыть окно').click();
    const same=await p.evaluate(async()=>{const before=JSON.stringify(NSDAnalytics.exportConfig());try{await NSDAnalytics.importConfig('{"constructor":{}}');}catch{}return before===JSON.stringify(NSDAnalytics.exportConfig());});
    assert.ok(same);
  });
  await report('Виртуализация 10 000 строк, Worker, поиск и клавиатура',async()=>{
    const load=await p.evaluate(()=>NSDAnalytics.open(NSDDemo.generate('tickets',10000),{widgets:[{type:'kpi'}]}));assert.equal(load.mode,'worker');
    await btn('Объекты').click();await ready();
    let n=await p.locator('.records tbody tr[tabindex]').count();assert.ok(n>0&&n<80);
    await p.locator('.table-viewport').evaluate(e=>{e.scrollTop=e.scrollHeight;});
    await p.waitForFunction(()=>document.querySelector('[data-nsd-analytics]').shadowRoot.querySelector('.records tbody').textContent.includes('demoCall$10000'));
    await p.getByRole('searchbox').fill('demoCall$9876');
    await p.waitForFunction(()=>document.querySelector('[data-nsd-analytics]').shadowRoot.querySelector('.table-tools small').textContent==='1 объектов');
    await p.locator('.records tbody tr[tabindex]').first().press('Enter');await modal().waitFor();assert.ok(await modal().isVisible());await p.keyboard.press('Escape');assert.equal(await modal().count(),0);
  });
  await report('Отмена загрузки, update, повторные открытия и полное закрытие',async()=>{
    const r=await p.evaluate(async()=>{
      const pending=NSDAnalytics.open(NSDDemo.generate('tickets',50000),{widgets:[]});
      NSDAnalytics.close();await pending;
      for(let i=0;i<6;i++){await NSDAnalytics.open([{n:i}]);await NSDAnalytics.update([{n:1},{n:2}]);}
      const n=document.querySelectorAll('[data-nsd-analytics]').length;NSDAnalytics.destroy();
      return [n,document.querySelectorAll('[data-nsd-analytics]').length];
    });assert.deepEqual(r,[1,0]);
  });
  await report('Встраивание, обработчик карточки, CSP fallback и мобильный экран',async()=>{
    const result=await p.evaluate(async()=>{
      const mount=document.createElement('div');document.body.append(mount);
      const data=NSDDemo.generate('assets',5000);
      const w=window.Worker;window.Worker=class{constructor(){throw new Error('Worker unavailable');}};
      try{return await NSDAnalytics.open(data,{mount,widgets:[{type:'table'}],onOpenObject:row=>{mount.dataset.opened=row.uuid;}});}
      finally{window.Worker=w;}
    });assert.equal(result.mode,'main');
    await p.locator('.records tbody tr[tabindex]').first().click();await btn('Открыть карточку').click();
    assert.equal(await p.locator('[data-opened]').getAttribute('data-opened'),'demoAsset$1');
    await p.evaluate(()=>NSDAnalytics.destroy());await p.setViewportSize({width:390,height:844});
    await p.evaluate(()=>NSDAnalytics.open(NSDDemo.generate('assets',100),NSDDemo.config('assets')));await ready();
    assert.ok(await p.evaluate(()=>{const s=document.querySelector('[data-nsd-analytics]').shadowRoot.querySelector('.shell');return s.scrollWidth<=s.clientWidth+1;}));
    await p.screenshot({path:imageDir+'/mobile.png'});await p.setViewportSize({width:1440,height:960});
  });
  await report('Сравнение периодов и все три синтетических набора',async()=>{
    await p.evaluate(()=>NSDAnalytics.open(NSDDemo.generate('people',1000),NSDDemo.config('people')));await ready();
    assert.equal(await p.locator('.widget').count(),7);await btn('Периоды').click();await ready();
    const dates=p.locator('input[type=date]');for(const [i,v] of ['2026-01-01','2026-01-31','2026-02-01','2026-02-28'].entries())await dates.nth(i).fill(v);
    await btn('Сравнить периоды').click();await p.getByText(/Предыдущий\s+\d.*Текущий/).waitFor();
  });
  await report('Браузер не обращался к сети и не выдавал необработанных ошибок',async()=>{
    assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
  });
  const summary={browser:browser.version(),viewport:'1440x960; 390x844',passed:passed.length,scenarios:passed,externalRequests:network.length,pageErrors:errors.length};
  if(saved)await writeFile('benchmarks/browser-tests.json',JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary));
}finally{await browser.close();}
