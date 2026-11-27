'use strict';

(function connectPortal() {
  const button = document.getElementById('openNsdForm');
  const status = document.getElementById('nsdConnection');
  const classFqn = button.dataset.classFqn;
  let urls;

  try {
    if (window.parent !== window && !window.jsApi &&
        typeof window.parent.injectJsApi === 'function') {
      window.parent.injectJsApi(window.parent, window);
    }
    urls = window.jsApi && window.jsApi.urls;
  } catch {
    // The host can restrict communication with the embedded frame.
  }

  if (!urls || typeof urls.objectAddForm !== 'function' || typeof urls.goTo !== 'function') {
    status.textContent = 'Форма NSD недоступна в этом окружении. Каталог ниже работает в деморежиме.';
    return;
  }

  button.disabled = false;
  status.textContent = 'Откроется штатная форма. Запрос поступит в NSD после сохранения в этой форме.';
  button.addEventListener('click', () => {
    try {
      const formUrl = urls.objectAddForm(classFqn);
      if (typeof formUrl !== 'string' || !formUrl.trim()) throw new Error('Unavailable form');
      urls.goTo(formUrl);
    } catch {
      status.textContent = 'Не удалось открыть форму. Проверьте код класса и доступ к созданию запроса в NSD.';
    }
  });
})();
