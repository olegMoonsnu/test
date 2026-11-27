import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {writeFile, readFile} from 'node:fs/promises';
import {openTableDialog} from '../src/adapters/table-dialog.js';

export async function buildTableModule(common) {
  const entry = await build({...common, entryPoints:['src/adapters/table-frame.js'], write:false,
    minify:true, define:{__NSD_WORKER__:'undefined'}});
  const code = entry.outputFiles[0].text.replace(/<\/script/ig, '<\\/script');
  const digest = createHash('sha256').update(code).digest('base64');
  const page = '<!doctype html><html lang="ru"><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; ' +
    "form-action 'none'; script-src 'sha256-" + digest + "'; style-src 'unsafe-inline'; img-src data: blob:; frame-src 'none'" + '">' +
    '<title>Аналитика таблицы</title><body><script id="analytics-payload" type="application/json">' +
    'NSD_TABLE_PACKET_HERE</script><script>' + code + '</script></body></html>';
  const prefix = '(' + openTableDialog.toString() + ')(' + JSON.stringify(page) + ',';
  // Groovy/JVM string constants have a 65535-byte limit. Join small independent constants at runtime.
  const parts = prefix.match(/[\s\S]{1,6000}/gu).map(s =>
    "'''" + s.replaceAll('\\','\\\\').replaceAll("'", "\\'") + "'''");
  const expression = '[' + parts.join(',\n') + "].join('')";
  const template = await readFile('scripts/table-module.groovy.in','utf8');
  const dir = 'groovy/table-studio';
  const action = await readFile(dir + '/TableButton.groovy', 'utf8');
  const marker = '/* GENERATED VIEWER */';
  const moduleHeader = '// Модуль NSD: nsdAnalyticsStudio. Код действия передаёт только разрешённую проекцию.\n';
  const imports = 'import groovy.json.JsonOutput\n\n';
  await writeFile(dir + '/nsdAnalyticsStudio.groovy',
    moduleHeader + imports + template.replace(marker, () => expression));

  // Inline the same renderer in a local object so the event body can also run
  // inside an enclosing NSD closure. Indent before inserting literal JS chunks.
  const invoke = '    result.executeJavaScript(modules.nsdAnalyticsStudio.open(rows, settings))';
  if (action.split(invoke).length !== 2) throw new Error('Expected one Studio call in TableButton.groovy');
  const localMethods = template.trimEnd().replace(/^(.+)$/gm, '        $1');
  const localCall = '    def studio = new Object() {\n' + localMethods.replace(marker, () => expression) +
    '\n    }\n    result.executeJavaScript(studio.open(rows, settings))';
  const actionHeader = '// Полное тело действия «Аналитика». Параметры находятся в начале файла.\n';
  await writeFile(dir + '/TableAnalyticsAction.groovy',
    actionHeader + imports + action.replace(invoke, () => localCall));
}
