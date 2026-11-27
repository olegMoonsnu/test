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
  const template = await readFile('scripts/table-module.groovy.in','utf8');
  await writeFile('groovy/table-studio/nsdAnalyticsStudio.groovy',
    template.replace('/* GENERATED VIEWER */', () => '[' + parts.join(',\n') + "].join('')"));
}
