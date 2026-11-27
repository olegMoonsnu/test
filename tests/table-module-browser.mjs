import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

const action = await readFile('test-output/table-module-fixture.js','utf8');
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,
  args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  const requests = [], errors = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<button id="table-button">Аналитика</button><table><tr><td>Исходная таблица</td></tr></table>');
  await page.locator('#table-button').focus();
  const launch = () => page.addScriptTag({content:action});
  await launch();
  const frame = page.frameLocator('#nsd-table-studio-frame-dialog iframe');
  const open = () => frame.locator('.shell[aria-busy=false]').waitFor();
  const button = label => frame.getByRole('button',{name:label,exact:true});
  await open();
  assert.equal(await frame.locator('.widget').count(),6);
  assert.equal(await frame.locator('[data-widget=count] .kpi-body strong').textContent(),'3');
  assert.equal(await frame.locator('[data-widget=mean] .kpi-body strong').textContent(),'20');
  const isolated = await page.frames()[1].evaluate(() => {
    try { void parent.document.body; return false; } catch { return true; }
  });
  assert.ok(isolated);
  await frame.locator('[data-widget=byStatus] .viz path[role=button]').first().press('Enter');
  await button('Показать исходные объекты').click(); await open();
  assert.equal(await frame.locator('.records tbody tr[tabindex]').count(),2);
  await button('Сбросить фильтры').click(); await open();
  await button('Сводная').click(); await open();
  assert.ok(await frame.locator('.pivot-table').isVisible());
  await button('Объекты').click(); await open();
  assert.ok(await frame.getByRole('cell',{name:'Закрыта </script> & $1',exact:true}).isVisible());
  await button('Экспорт').click();
  const pending = page.waitForEvent('download');
  await button('CSV').click();
  const data = await readFile(await (await pending).path(),'utf8');
  assert.ok(data.includes('В работе') && !data.includes('secret_value_not_in_report'));
  await launch(); await open();
  assert.equal(await page.locator('dialog[open]').count(),1);
  await button('Закрыть').click();
  await page.locator('#nsd-table-studio-frame-dialog').waitFor({state:'detached'});
  await launch(); await open(); await button('Закрыть').click();
  assert.ok(await page.locator('#table-button').isVisible());
  assert.equal(page.url(),'about:blank');
  assert.deepEqual(errors,[]);
  assert.deepEqual(requests,[]);
  // An inherited host CSP blocking document scripts must leave a closable error.
  await page.route('https://fixture.test/**', route => {
    if (route.request().url().endsWith('/action.js')) return route.fulfill({contentType:'application/javascript; charset=utf-8',body:action});
    return route.fulfill({headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"script-src 'self'; frame-src 'self'"},
      body:'<!doctype html><meta charset="utf-8"><body><script src="/action.js"></script></body>'});
  });
  await page.goto('https://fixture.test/');
  await page.getByRole('status').filter({hasText:'Окно Studio не запустилось'}).waitFor({timeout:22000});
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  assert.equal(await page.locator('dialog[open]').count(),0);
  console.log('Table module in Chromium: KPI, filtered source rows, pivot, CSV, isolation, no network, repeat, close and CSP failure passed.');
} finally { await browser.close(); }
