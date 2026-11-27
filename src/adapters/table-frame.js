// The entire dashboard runs inside an opaque-origin frame. Only lifecycle signals
// cross its boundary. Records and dashboard configuration stay in this document.
import {Studio} from '../components/studio.js';
import {config} from '../core/config.js';

const signal = status => parent.postMessage('nsd-table-studio-v1:' + status, '*');
// In the opaque frame the classic nested print window is unavailable.
class TableStudio extends Studio {
  print() {
    this.notice.textContent = 'Сохраните отчёт через Экспорт → HTML, откройте файл и нажмите Ctrl+P.';
  }
}

function tableDefaults(settings) {
  if (!settings.columns?.some(c => c.code === 'status') ||
      !settings.columns.some(c => c.code === 'objectType')) return settings;
  const metric = settings.columns.find(c => c.type === 'number');
  const widgets = [
    {id:'count', title:'Всего объектов', type:'kpi'},
    {id:'types', title:'Типов объектов', type:'kpi', measure:{op:'distinct', field:'objectType'}},
    {id:'statuses', title:'Статусов в выборке', type:'kpi', measure:{op:'distinct', field:'status'}},
    ...(metric ? [{id:'mean', title:'Среднее · ' + metric.title, type:'kpi', measure:{op:'avg', field:metric.code}}] : []),
    {id:'byStatus', title:'Распределение по статусам', type:'donut', dims:['status','objectType']},
    {id:'byType', title:'Распределение по типам', type:'bar', dims:['objectType','status']}
  ];
  return {widgets, pivot:{rows:['objectType'], cols:['status'], measures:[{op:'count'}]}, ...settings};
}

async function openReport() {
  const data = document.getElementById('analytics-payload');
  const packet = JSON.parse(data.textContent);
  data.remove();
  const studio = new TableStudio(config(tableDefaults(packet.settings)), {worker:false, messages:{'Печать отчёта':'Как распечатать отчёт'}}, () => {
    studio.dispose();
    signal('closed');
  });
  await studio.load(packet.rows);
  if (!studio.closed) signal('ready');
}
openReport().catch(() => signal('failed'));
