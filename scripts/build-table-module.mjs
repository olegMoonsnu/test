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
  // A host may put the returned JS inside an HTML script element. Encode HTML
  // delimiters in the string literal before handing the program to the host.
  const pageLiteral = JSON.stringify(page).replaceAll('<', '\\u003c');
  const prefix = '(' + openTableDialog.toString() + ')(' + pageLiteral + ',';
  // Groovy/JVM string constants have a 65535-byte limit. Join small independent constants at runtime.
  const parts = prefix.match(/[\s\S]{1,6000}/gu).map(s =>
    "'''" + s.replaceAll('\\','\\\\').replaceAll("'", "\\'") + "'''");
  const expression = '[' + parts.join(',\n') + "].join('')";
  const packet = (await readFile('scripts/table-packet.groovy.in','utf8')).trimEnd();
  const dir = 'groovy/table-studio';
  const action = await readFile(dir + '/TableButton.groovy', 'utf8');
  const indent = src => src.replace(/^(.+)$/gm, '    $1');
  const imports = 'import groovy.json.JsonOutput\n\n';
  const jsExpression = expression + " + packet + ');'";
  const moduleHeader = '// Модуль NSD: nsdAnalyticsStudio. Код действия передаёт только разрешённую проекцию.\n';
  await writeFile(dir + '/nsdAnalyticsStudio.groovy', moduleHeader + imports +
    'String open(List rows, Map settings) {\n' + indent(packet) + '\n    return ' + jsExpression + '\n}\n');

  const call = '    String js = modules.nsdAnalyticsStudio.open(rows, settings)';
  if (action.split(call).length !== 2) throw new Error('Expected one Studio call in TableButton.groovy');
  const actionHeader = '// Полное тело действия «Аналитика». Параметры находятся в начале файла.\n';
  // The single event contains plain Groovy statements and one directly typed
  // result.executeJavaScript(js) call. No auxiliary module or anonymous class.
  await writeFile(dir + '/TableAnalyticsAction.groovy', actionHeader + imports +
    action.replace(call, () => indent(packet) + '\n    String js = ' + jsExpression));
}
