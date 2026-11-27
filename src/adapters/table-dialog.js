// This function is serialized by the build. Keep it independent of imports.
// The host receives only this dialog launcher. Studio runs in the sandbox.
export function openTableDialog(page, packet) {
  const id = 'nsd-table-studio-frame-dialog';
  document.getElementById(id)?.dispatchEvent(new Event('nsd-table-studio-replace'));
  const focus = document.activeElement;
  const dialog = document.createElement('dialog');
  if (!document.body || typeof dialog.showModal !== 'function' || typeof AbortController !== 'function') {
    window.alert('Код кнопки выполнен. В этом окне браузера недоступны функции для открытия Studio.');
    return;
  }
  dialog.id = id;
  dialog.setAttribute('aria-label', 'Аналитика по текущей таблице');
  Object.assign(dialog.style, {
    position:'fixed', inset:'0', width:'100%', height:'100%', maxWidth:'none',
    maxHeight:'none', border:'0', margin:'0', padding:'0', background:'transparent'
  });
  const notice = document.createElement('div');
  Object.assign(notice.style, {background:'white', color:'#242538', padding:'1em', font:'16px system-ui'});
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.textContent = 'Открывается аналитика… ';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Закрыть';
  notice.append(status, close);
  const frame = document.createElement('iframe');
  frame.title = 'NSD Analytics Studio';
  frame.setAttribute('sandbox', 'allow-scripts allow-downloads');
  frame.referrerPolicy = 'no-referrer';
  Object.assign(frame.style, {display:'none', width:'100%', height:'100%', border:'0'});
  const listeners = new AbortController();
  const options = {signal:listeners.signal};
  function dispose() {
    clearTimeout(timer);
    listeners.abort();
    if (dialog.open) dialog.close();
    dialog.remove();
    if (focus?.isConnected) focus.focus();
  }
  function fail() {
    clearTimeout(timer);
    frame.remove();
    status.textContent = 'Окно Studio не запустилось. Проверьте настройки отчёта и политику загрузки фреймов на стенде. ';
    notice.hidden = false;
    close.focus();
  }
  const timer = setTimeout(fail, 15000);
  close.onclick = dispose;
  dialog.addEventListener('cancel', e => { e.preventDefault(); dispose(); }, options);
  dialog.addEventListener('nsd-table-studio-replace', dispose, options);
  window.addEventListener('pagehide', dispose, options);
  window.addEventListener('message', e => {
    if (!frame.isConnected || e.source !== frame.contentWindow || e.origin !== 'null') return;
    if (e.data === 'nsd-table-studio-v1:closed') dispose();
    if (e.data === 'nsd-table-studio-v1:failed') fail();
    if (e.data === 'nsd-table-studio-v1:ready') {
      clearTimeout(timer);
      notice.hidden = true;
      frame.style.display = 'block';
      frame.focus();
    }
  }, options);
  dialog.append(notice, frame);
  document.body.append(dialog);
  try {
    dialog.showModal();
  } catch {
    dispose();
    window.alert('Код кнопки выполнен, но браузер не смог открыть диалог Studio.');
    return;
  }
  try {
    // The marker is in an application/json element, separate from executable code.
    frame.srcdoc = page.replace('NSD_TABLE_PACKET_HERE', () => packet.replace(/</g, '\\u003c'));
  } catch {
    fail();
  }
}
