import './nsd.js';
import styles from '../styles/customization.css';

// The catalog loads one classic script. The launcher needs no NSD object model.
const nonce = document.currentScript?.nonce;
const hostId = 'nsd-analytics-studio-launcher';
const maxFileBytes = 16 * 1024 * 1024;

function button(label) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  return element;
}

function install() {
  if (document.getElementById(hostId)) return;
  const host = document.createElement('div');
  host.id = hostId;
  const root = host.attachShadow({mode: 'open', delegatesFocus: true});
  const style = document.createElement('style');
  if (nonce) style.nonce = nonce;
  style.textContent = styles;

  const launcher = button('Аналитика');
  launcher.className = 'launcher';
  launcher.setAttribute('aria-haspopup', 'dialog');
  const chooser = document.createElement('dialog');
  chooser.setAttribute('aria-labelledby', 'studio-data-title');
  const heading = document.createElement('h2');
  heading.id = 'studio-data-title';
  heading.textContent = 'Открыть аналитику';
  const demo = button('Открыть демо');
  const upload = button('Выбрать файл JSON');
  const close = button('Закрыть');
  close.className = 'close';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  const hint = document.createElement('p');
  hint.textContent = 'Выберите JSON-массив объектов (до 16 МиБ) или посмотрите демо на трёх заявках.';
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const actions = document.createElement('div');
  actions.append(demo, upload, close);
  chooser.append(heading, hint, actions, fileInput, message);
  root.append(style, launcher, chooser);
  document.body.append(host);

  let generation = 0;
  function reset() {
    generation++;
    fileInput.value = '';
    message.textContent = '';
    demo.disabled = false;
    upload.disabled = false;
  }

  async function show(rows, config) {
    chooser.close();
    launcher.focus();
    try {
      await window.NSDAnalytics.open(rows, {...config, nonce});
    } catch (error) {
      // Studio reports load errors in its own dialog. Earlier failures have no UI.
      if (!document.querySelector('[data-nsd-analytics="studio"]')) {
        chooser.showModal();
        message.textContent = error.message || 'Не удалось открыть аналитику';
      }
    }
  }

  launcher.onclick = () => {
    if (!chooser.open) {
      reset();
      chooser.showModal();
    }
  };
  close.onclick = () => chooser.close();
  chooser.onclose = () => { generation++; };
  demo.onclick = () => show([
    {status: 'В работе', duration: 30},
    {status: 'В работе', duration: 60},
    {status: 'Закрыта', duration: 90}
  ], {
    title: 'Демо · 3 вымышленные заявки',
    columns: [
      {code: 'status', title: 'Статус', type: 'string'},
      {code: 'duration', title: 'Время решения', type: 'number', unit: 'мин'}
    ],
    widgets: [
      {id: 'count', title: 'Всего заявок', type: 'kpi'},
      {id: 'average', title: 'Среднее время, мин', type: 'kpi', measure: {op: 'avg', field: 'duration'}},
      {id: 'statuses', title: 'Заявки по статусам', type: 'bar', dims: ['status']}
    ]
  });
  upload.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const request = ++generation;
    try {
      demo.disabled = upload.disabled = true;
      if (file.size > maxFileBytes) throw new Error('Файл превышает 16 МиБ');
      message.textContent = 'Чтение файла…';
      const content = await file.text();
      if (request !== generation || !chooser.open) return;
      let rows;
      try { rows = JSON.parse(content); }
      catch { throw new Error('Не удалось прочитать JSON. Проверьте формат файла и кодировку UTF-8.'); }
      if (!Array.isArray(rows)) throw new Error('В файле ожидается массив объектов JSON');
      await show(rows, {title: 'Аналитика из файла'});
    } catch (error) {
      if (request === generation) message.textContent = error.message;
    } finally {
      if (request === generation) demo.disabled = upload.disabled = false;
    }
  };
}

if (document.body) install();
else document.addEventListener('DOMContentLoaded', install, {once: true});
