import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const adapter = readFileSync(new URL('../src/portal/nsd.js', import.meta.url), 'utf8');

function mount(parent) {
  const button = { disabled: true, dataset: { classFqn: 'serviceCall' },
    addEventListener(event, listener) { assert.equal(event, 'click'); this.click = listener; } };
  const status = { textContent: '' };
  const document = { getElementById(id) { return { openNsdForm: button, nsdConnection: status }[id]; } };
  const window = { parent };
  runInNewContext(adapter, { window, document });
  return { button, status };
}

test('embedded portal opens the platform-provided form only after a click', () => {
  const visited = [];
  const parent = { injectJsApi(host, frame) {
    assert.equal(host, parent);
    frame.jsApi = { urls: {
      objectAddForm(fqn) { assert.equal(fqn, 'serviceCall'); return 'test-form'; },
      goTo(url) { visited.push(url); }
    } };
  } };
  const { button } = mount(parent);
  assert.equal(button.disabled, false);
  assert.deepEqual(visited, []);
  button.click();
  assert.deepEqual(visited, ['test-form']);
});

test('unavailable host leaves demo usable and displays a diagnostic', () => {
  for (const parent of [{}, { injectJsApi() { throw new Error('Blocked frame'); } }]) {
    const { button, status } = mount(parent);
    assert.equal(button.disabled, true);
    assert.match(status.textContent, /недоступна/);
  }
});

test('unavailable form displays an error without navigation', () => {
  let navigated = false;
  const { button, status } = mount({ injectJsApi(host, frame) {
    frame.jsApi = { urls: { objectAddForm: () => '', goTo() { navigated = true; } } };
  } });
  button.click();
  assert.equal(navigated, false);
  assert.match(status.textContent, /Не удалось/);
});
