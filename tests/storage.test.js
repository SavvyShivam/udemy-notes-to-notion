import { test } from 'node:test';
import assert from 'node:assert/strict';

function installFakeChromeStorage() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (obj) => { Object.assign(store, obj); }
      }
    }
  };
  return store;
}

test('getConfig returns defaults when nothing stored', async () => {
  installFakeChromeStorage();
  const { getConfig } = await import('../src/storage.js?t=' + Date.now());
  const config = await getConfig();
  assert.deepEqual(config, { groqApiKey: '', notionToken: '', notionParentPageId: '' });
});

test('setConfig then getConfig round-trips', async () => {
  installFakeChromeStorage();
  const { getConfig, setConfig } = await import('../src/storage.js?t=' + Date.now());
  await setConfig({ groqApiKey: 'g1', notionToken: 'n1', notionParentPageId: 'p1' });
  const config = await getConfig();
  assert.deepEqual(config, { groqApiKey: 'g1', notionToken: 'n1', notionParentPageId: 'p1' });
});

test('getCourseCache returns empty shape for unknown course', async () => {
  installFakeChromeStorage();
  const { getCourseCache } = await import('../src/storage.js?t=' + Date.now());
  const cache = await getCourseCache('New Course');
  assert.deepEqual(cache, { pageId: null, sections: {}, lectures: {} });
});

test('setCourseCache then getCourseCache round-trips and preserves other courses', async () => {
  installFakeChromeStorage();
  const { getCourseCache, setCourseCache } = await import('../src/storage.js?t=' + Date.now());
  await setCourseCache('Course A', { pageId: 'pA', sections: {}, lectures: {} });
  await setCourseCache('Course B', { pageId: 'pB', sections: {}, lectures: {} });
  assert.deepEqual(await getCourseCache('Course A'), { pageId: 'pA', sections: {}, lectures: {} });
  assert.deepEqual(await getCourseCache('Course B'), { pageId: 'pB', sections: {}, lectures: {} });
});
