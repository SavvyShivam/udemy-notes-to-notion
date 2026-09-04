# Udemy Notion Note Taker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that scrapes a Udemy lecture's transcript, summarizes it via Groq into a brief + bullet notes, and syncs those notes into a structured Notion page (course → section → lecture toggle), idempotently.

**Architecture:** Three runtime pieces — a content script (Udemy DOM scraping + button injection), a background service worker (owns all Groq/Notion API calls and the local ID cache), and an options page (BYOK settings: Groq key, Notion token, Notion parent page). No bundler: background.js and options.js use native ES modules; content-script.js is a self-contained classic script (Chrome does not support ES-module content scripts via manifest).

**Tech Stack:** Vanilla JS, Chrome Manifest V3 APIs (`chrome.storage.local`, `chrome.runtime.onMessage`), Groq chat completions API, Notion API v2022-06-28, Node's built-in `node:test` runner for unit tests (no test framework dependency).

**Spec:** [docs/superpowers/specs/2026-09-04-udemy-notion-notetaker-design.md](../specs/2026-09-04-udemy-notion-notetaker-design.md)

## Global Constraints

- No backend/server component — all API calls go directly from the extension to Groq and Notion.
- BYOK only: Groq API key + Notion integration token, both entered by the user in the options page.
- Manual trigger only: notes are generated/synced only when the user clicks "Save Notes" — no auto-trigger on video end.
- Re-saving a lecture must update the existing Notion toggle in place, never duplicate it (idempotency via the local ID cache in `chrome.storage.local`).
- No new npm dependencies — use native `fetch`, native ES modules, and `node:test` for testing.

---

## File Structure

```
manifest.json
package.json
src/
  storage.js          — chrome.storage.local wrapper: config + per-course ID cache
  groq-client.js       — Groq prompt building, response parsing, API call
  notion-client.js     — Notion payload building + find-or-create/replace API calls
  background.js         — message listener; orchestrates groq-client + notion-client + storage
  content-script.js     — Udemy DOM scraping + "Save Notes" button injection
  options.html
  options.js           — settings form bound to storage.js
tests/
  storage.test.js
  groq-client.test.js
  notion-client.test.js
  background.test.js
README.md
```

### Task 1: Project scaffolding + storage.js

**Files:**
- Create: `package.json`
- Create: `manifest.json`
- Create: `src/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces: `getConfig(): Promise<{groqApiKey: string, notionToken: string, notionParentPageId: string}>`, `setConfig(config): Promise<void>`, `getCourseCache(courseTitle: string): Promise<{pageId: string|null, sections: object, lectures: object}>`, `setCourseCache(courseTitle: string, courseData: object): Promise<void>` — used by background.js (Task 4) and options.js (Task 6).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "udemy-notion-notetaker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Udemy Notes to Notion",
  "version": "0.1.0",
  "description": "Summarize Udemy lecture transcripts and save them to Notion.",
  "permissions": ["storage"],
  "host_permissions": [
    "https://*.udemy.com/*",
    "https://api.groq.com/*",
    "https://api.notion.com/*"
  ],
  "background": {
    "service_worker": "src/background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://*.udemy.com/course/*/learn/*"],
      "js": ["src/content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "options_page": "src/options.html"
}
```

- [ ] **Step 3: Write the failing test for storage.js**

Create `tests/storage.test.js`:

```javascript
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `src/storage.js` does not exist yet (module not found).

- [ ] **Step 5: Write `src/storage.js`**

```javascript
const CONFIG_KEY = 'config';
const CACHE_KEY = 'courseCache';

export async function getConfig() {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return result[CONFIG_KEY] || { groqApiKey: '', notionToken: '', notionParentPageId: '' };
}

export async function setConfig(config) {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export async function getCourseCache(courseTitle) {
  const result = await chrome.storage.local.get(CACHE_KEY);
  const cache = result[CACHE_KEY] || {};
  return cache[courseTitle] || { pageId: null, sections: {}, lectures: {} };
}

export async function setCourseCache(courseTitle, courseData) {
  const result = await chrome.storage.local.get(CACHE_KEY);
  const cache = result[CACHE_KEY] || {};
  cache[courseTitle] = courseData;
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 tests in `storage.test.js`)

- [ ] **Step 7: Commit**

```bash
git init
git add package.json manifest.json src/storage.js tests/storage.test.js
git commit -m "feat: scaffold extension and add storage layer"
```

---

### Task 2: groq-client.js

**Files:**
- Create: `src/groq-client.js`
- Test: `tests/groq-client.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildPrompt(transcriptText: string): Array<{role, content}>`, `parseGroqResponse(rawText: string): {brief: string, bullets: string[]}`, `summarizeTranscript(transcriptText: string, apiKey: string, fetchImpl?: Function): Promise<{brief: string, bullets: string[]}>` — used by background.js (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `tests/groq-client.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseGroqResponse, summarizeTranscript } from '../src/groq-client.js';

test('buildPrompt returns a system + user message pair containing the transcript', () => {
  const messages = buildPrompt('hello world transcript');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /hello world transcript/);
});

test('parseGroqResponse parses well-formed BRIEF/BULLETS output', () => {
  const raw = 'BRIEF: This lecture covers closures.\nBULLETS:\n- Closures capture scope\n- Used for data privacy\n- Common in callbacks';
  const result = parseGroqResponse(raw);
  assert.equal(result.brief, 'This lecture covers closures.');
  assert.deepEqual(result.bullets, ['Closures capture scope', 'Used for data privacy', 'Common in callbacks']);
});

test('parseGroqResponse handles missing BULLETS section', () => {
  const raw = 'BRIEF: Just a brief, no bullets.';
  const result = parseGroqResponse(raw);
  assert.equal(result.brief, 'Just a brief, no bullets.');
  assert.deepEqual(result.bullets, []);
});

test('parseGroqResponse falls back to whole text as brief when unformatted', () => {
  const raw = 'The model ignored instructions and just wrote prose.';
  const result = parseGroqResponse(raw);
  assert.equal(result.brief, 'The model ignored instructions and just wrote prose.');
  assert.deepEqual(result.bullets, []);
});

test('summarizeTranscript posts to Groq and returns parsed result', async () => {
  let capturedUrl, capturedOptions;
  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'BRIEF: b\nBULLETS:\n- one' } }] })
    };
  };

  const result = await summarizeTranscript('some transcript', 'test-key', fakeFetch);

  assert.equal(capturedUrl, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(result, { brief: 'b', bullets: ['one'] });
});

test('summarizeTranscript throws with status and body on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'bad key' });
  await assert.rejects(
    () => summarizeTranscript('t', 'bad-key', fakeFetch),
    /Groq API error 401: bad key/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `src/groq-client.js` does not exist.

- [ ] **Step 3: Write `src/groq-client.js`**

```javascript
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

export function buildPrompt(transcriptText) {
  return [
    {
      role: 'system',
      content:
        'You summarize video lecture transcripts. Respond in exactly this format:\n' +
        'BRIEF: <2-3 sentence summary>\n' +
        'BULLETS:\n- <point>\n- <point>\n(one bullet per line, each starting with "- ")'
    },
    {
      role: 'user',
      content: `Transcript:\n${transcriptText}`
    }
  ];
}

export function parseGroqResponse(rawText) {
  const briefMatch = rawText.match(/BRIEF:\s*([\s\S]*?)(?:\nBULLETS:|$)/i);
  const bulletsMatch = rawText.match(/BULLETS:\s*([\s\S]*)/i);

  const brief = briefMatch ? briefMatch[1].trim() : rawText.trim();
  const bullets = bulletsMatch
    ? bulletsMatch[1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim())
    : [];

  return { brief, bullets };
}

export async function summarizeTranscript(transcriptText, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: buildPrompt(transcriptText),
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const rawText = data.choices[0].message.content;
  return parseGroqResponse(rawText);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (6 tests in `groq-client.test.js`, plus the 4 from Task 1)

- [ ] **Step 5: Commit**

```bash
git add src/groq-client.js tests/groq-client.test.js
git commit -m "feat: add Groq transcript summarization client"
```

---

### Task 3: notion-client.js

**Files:**
- Create: `src/notion-client.js`
- Test: `tests/notion-client.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (cache objects passed in match the shape produced by `getCourseCache` in Task 1: `{pageId, sections, lectures}`).
- Produces: `buildLectureChildren(brief: string, bullets: string[]): object[]`, `findOrCreateCoursePage(courseTitle, cache, token, parentPageId, fetchImpl?): Promise<string>`, `findOrCreateSectionHeading(sectionTitle, coursePageId, cache, token, fetchImpl?): Promise<string>`, `findOrCreateLectureToggle(lectureTitle, coursePageId, cache, token, fetchImpl?): Promise<string>`, `replaceToggleChildren(toggleBlockId, brief, bullets, token, fetchImpl?): Promise<void>` — all used by background.js (Task 4). Each `findOrCreate*` mutates the passed-in `cache` object in place (setting `cache.pageId`, `cache.sections[title]`, `cache.lectures[title]`) so the caller can persist it via `setCourseCache`.

- [ ] **Step 1: Write the failing tests**

Create `tests/notion-client.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLectureChildren,
  findOrCreateCoursePage,
  findOrCreateSectionHeading,
  findOrCreateLectureToggle,
  replaceToggleChildren
} from '../src/notion-client.js';

test('buildLectureChildren builds a paragraph followed by bulleted list items', () => {
  const children = buildLectureChildren('the brief', ['one', 'two']);
  assert.equal(children.length, 3);
  assert.equal(children[0].type, 'paragraph');
  assert.equal(children[0].paragraph.rich_text[0].text.content, 'the brief');
  assert.equal(children[1].type, 'bulleted_list_item');
  assert.equal(children[1].bulleted_list_item.rich_text[0].text.content, 'one');
  assert.equal(children[2].bulleted_list_item.rich_text[0].text.content, 'two');
});

test('findOrCreateCoursePage returns cached id without calling fetch', async () => {
  const cache = { pageId: 'existing-page', sections: {}, lectures: {} };
  let called = false;
  const fakeFetch = async () => { called = true; };
  const id = await findOrCreateCoursePage('Course', cache, 'token', 'parent', fakeFetch);
  assert.equal(id, 'existing-page');
  assert.equal(called, false);
});

test('findOrCreateCoursePage creates a page and updates cache when none cached', async () => {
  const cache = { pageId: null, sections: {}, lectures: {} };
  let capturedBody;
  const fakeFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: 'new-page-id' }) };
  };
  const id = await findOrCreateCoursePage('My Course', cache, 'token', 'parent-id', fakeFetch);
  assert.equal(id, 'new-page-id');
  assert.equal(cache.pageId, 'new-page-id');
  assert.equal(capturedBody.parent.page_id, 'parent-id');
  assert.equal(capturedBody.properties.title.title[0].text.content, 'My Course');
});

test('findOrCreateSectionHeading returns cached id without calling fetch', async () => {
  const cache = { pageId: 'p', sections: { 'Section 1': { headingBlockId: 'h1' } }, lectures: {} };
  let called = false;
  const id = await findOrCreateSectionHeading('Section 1', 'p', cache, 'token', async () => { called = true; });
  assert.equal(id, 'h1');
  assert.equal(called, false);
});

test('findOrCreateSectionHeading creates heading+divider and caches heading id', async () => {
  const cache = { pageId: 'p', sections: {}, lectures: {} };
  let capturedBody;
  const fakeFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ results: [{ id: 'heading-id' }, { id: 'divider-id' }] }) };
  };
  const id = await findOrCreateSectionHeading('Intro', 'p', cache, 'token', fakeFetch);
  assert.equal(id, 'heading-id');
  assert.equal(cache.sections['Intro'].headingBlockId, 'heading-id');
  assert.equal(capturedBody.children[0].type, 'heading_2');
  assert.equal(capturedBody.children[1].type, 'divider');
});

test('findOrCreateLectureToggle creates a toggle and caches its id', async () => {
  const cache = { pageId: 'p', sections: {}, lectures: {} };
  const fakeFetch = async () => ({ ok: true, json: async () => ({ results: [{ id: 'toggle-id' }] }) });
  const id = await findOrCreateLectureToggle('Lecture 1', 'p', cache, 'token', fakeFetch);
  assert.equal(id, 'toggle-id');
  assert.equal(cache.lectures['Lecture 1'].toggleBlockId, 'toggle-id');
});

test('replaceToggleChildren deletes existing children then appends new ones', async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if ((options.method || 'GET') === 'GET') {
      return { ok: true, json: async () => ({ results: [{ id: 'old-1' }, { id: 'old-2' }] }) };
    }
    return { ok: true, json: async () => ({ results: [] }) };
  };

  await replaceToggleChildren('toggle-id', 'new brief', ['new bullet'], 'token', fakeFetch);

  assert.equal(calls[0].method, 'GET');
  assert.deepEqual(calls.slice(1, 3).map((c) => c.method), ['DELETE', 'DELETE']);
  assert.equal(calls[3].method, 'PATCH');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `src/notion-client.js` does not exist.

- [ ] **Step 3: Write `src/notion-client.js`**

```javascript
const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
  };
}

export function buildLectureChildren(brief, bullets) {
  const children = [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: brief } }] }
    }
  ];
  for (const bullet of bullets) {
    children.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [{ type: 'text', text: { content: bullet } }] }
    });
  }
  return children;
}

export async function findOrCreateCoursePage(courseTitle, cache, token, parentPageId, fetchImpl = fetch) {
  if (cache.pageId) return cache.pageId;

  const response = await fetchImpl(`${NOTION_API_URL}/pages`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      properties: {
        title: { title: [{ type: 'text', text: { content: courseTitle } }] }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Notion create page error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  cache.pageId = data.id;
  return data.id;
}

export async function findOrCreateSectionHeading(sectionTitle, coursePageId, cache, token, fetchImpl = fetch) {
  if (cache.sections[sectionTitle]) return cache.sections[sectionTitle].headingBlockId;

  const response = await fetchImpl(`${NOTION_API_URL}/blocks/${coursePageId}/children`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({
      children: [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: sectionTitle } }] }
        },
        { object: 'block', type: 'divider', divider: {} }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Notion create section error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const headingBlockId = data.results[0].id;
  cache.sections[sectionTitle] = { headingBlockId };
  return headingBlockId;
}

export async function findOrCreateLectureToggle(lectureTitle, coursePageId, cache, token, fetchImpl = fetch) {
  if (cache.lectures[lectureTitle]) return cache.lectures[lectureTitle].toggleBlockId;

  const response = await fetchImpl(`${NOTION_API_URL}/blocks/${coursePageId}/children`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({
      children: [
        {
          object: 'block',
          type: 'toggle',
          toggle: { rich_text: [{ type: 'text', text: { content: lectureTitle } }] }
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Notion create lecture error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const toggleBlockId = data.results[0].id;
  cache.lectures[lectureTitle] = { toggleBlockId };
  return toggleBlockId;
}

export async function replaceToggleChildren(toggleBlockId, brief, bullets, token, fetchImpl = fetch) {
  const listResponse = await fetchImpl(`${NOTION_API_URL}/blocks/${toggleBlockId}/children`, {
    headers: headers(token)
  });
  if (!listResponse.ok) {
    throw new Error(`Notion list children error ${listResponse.status}: ${await listResponse.text()}`);
  }
  const { results } = await listResponse.json();

  for (const block of results) {
    const deleteResponse = await fetchImpl(`${NOTION_API_URL}/blocks/${block.id}`, {
      method: 'DELETE',
      headers: headers(token)
    });
    if (!deleteResponse.ok) {
      throw new Error(`Notion delete child error ${deleteResponse.status}: ${await deleteResponse.text()}`);
    }
  }

  const appendResponse = await fetchImpl(`${NOTION_API_URL}/blocks/${toggleBlockId}/children`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ children: buildLectureChildren(brief, bullets) })
  });
  if (!appendResponse.ok) {
    throw new Error(`Notion append children error ${appendResponse.status}: ${await appendResponse.text()}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (7 tests in `notion-client.test.js`, plus prior tests)

- [ ] **Step 5: Commit**

```bash
git add src/notion-client.js tests/notion-client.test.js
git commit -m "feat: add Notion find-or-create and sync client"
```

---

### Task 4: background.js (orchestration)

**Files:**
- Create: `src/background.js`
- Test: `tests/background.test.js`

**Interfaces:**
- Consumes: `getConfig`, `getCourseCache`, `setCourseCache` from `src/storage.js` (Task 1); `summarizeTranscript` from `src/groq-client.js` (Task 2); `findOrCreateCoursePage`, `findOrCreateSectionHeading`, `findOrCreateLectureToggle`, `replaceToggleChildren` from `src/notion-client.js` (Task 3).
- Produces: `saveNotes(payload: {courseTitle, sectionTitle, lectureTitle, transcriptText}, deps?: object): Promise<{brief: string, bullets: string[]}>` — exported for testing; also wired to a `chrome.runtime.onMessage` listener for `{type: 'SAVE_NOTES', payload}` messages, used by content-script.js (Task 5), responding with `{ok: true, result}` or `{ok: false, error: string}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/background.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveNotes } from '../src/background.js';

function makeDeps(overrides = {}) {
  const savedCacheCalls = [];
  return {
    getConfig: async () => ({ groqApiKey: 'gk', notionToken: 'nt', notionParentPageId: 'pp' }),
    summarizeTranscript: async () => ({ brief: 'a brief', bullets: ['b1', 'b2'] }),
    getCourseCache: async () => ({ pageId: null, sections: {}, lectures: {} }),
    setCourseCache: async (title, cache) => { savedCacheCalls.push({ title, cache: { ...cache } }); },
    findOrCreateCoursePage: async (title, cache) => { cache.pageId = 'page-1'; return 'page-1'; },
    findOrCreateSectionHeading: async (title, pageId, cache) => { cache.sections[title] = { headingBlockId: 'h-1' }; return 'h-1'; },
    findOrCreateLectureToggle: async (title, pageId, cache) => { cache.lectures[title] = { toggleBlockId: 't-1' }; return 't-1'; },
    replaceToggleChildren: async () => {},
    _savedCacheCalls: savedCacheCalls,
    ...overrides
  };
}

test('saveNotes throws when settings are missing', async () => {
  const deps = makeDeps({ getConfig: async () => ({ groqApiKey: '', notionToken: '', notionParentPageId: '' }) });
  await assert.rejects(
    () => saveNotes({ courseTitle: 'C', sectionTitle: 'S', lectureTitle: 'L', transcriptText: 'T' }, deps),
    /Configure settings first/
  );
});

test('saveNotes calls summarize then notion steps in order and returns the summary', async () => {
  const order = [];
  const deps = makeDeps({
    summarizeTranscript: async () => { order.push('summarize'); return { brief: 'b', bullets: ['x'] }; },
    findOrCreateCoursePage: async (title, cache) => { order.push('coursePage'); cache.pageId = 'page-1'; return 'page-1'; },
    findOrCreateSectionHeading: async (title, pageId, cache) => { order.push('section'); cache.sections[title] = { headingBlockId: 'h-1' }; return 'h-1'; },
    findOrCreateLectureToggle: async (title, pageId, cache) => { order.push('lecture'); cache.lectures[title] = { toggleBlockId: 't-1' }; return 't-1'; },
    replaceToggleChildren: async () => { order.push('replace'); }
  });

  const result = await saveNotes({ courseTitle: 'C', sectionTitle: 'S', lectureTitle: 'L', transcriptText: 'T' }, deps);

  assert.deepEqual(order, ['summarize', 'coursePage', 'section', 'lecture', 'replace']);
  assert.deepEqual(result, { brief: 'b', bullets: ['x'] });
});

test('saveNotes persists the cache after each Notion step', async () => {
  const deps = makeDeps();
  await saveNotes({ courseTitle: 'C', sectionTitle: 'S', lectureTitle: 'L', transcriptText: 'T' }, deps);
  assert.equal(deps._savedCacheCalls.length, 3);
  assert.equal(deps._savedCacheCalls[0].cache.pageId, 'page-1');
  assert.equal(deps._savedCacheCalls[1].cache.sections['S'].headingBlockId, 'h-1');
  assert.equal(deps._savedCacheCalls[2].cache.lectures['L'].toggleBlockId, 't-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `src/background.js` does not exist.

- [ ] **Step 3: Write `src/background.js`**

```javascript
import { getConfig, getCourseCache, setCourseCache } from './storage.js';
import { summarizeTranscript } from './groq-client.js';
import {
  findOrCreateCoursePage,
  findOrCreateSectionHeading,
  findOrCreateLectureToggle,
  replaceToggleChildren
} from './notion-client.js';

export async function saveNotes({ courseTitle, sectionTitle, lectureTitle, transcriptText }, deps = {}) {
  const doGetConfig = deps.getConfig || getConfig;
  const doSummarize = deps.summarizeTranscript || summarizeTranscript;
  const doGetCache = deps.getCourseCache || getCourseCache;
  const doSetCache = deps.setCourseCache || setCourseCache;
  const doFindCoursePage = deps.findOrCreateCoursePage || findOrCreateCoursePage;
  const doFindSectionHeading = deps.findOrCreateSectionHeading || findOrCreateSectionHeading;
  const doFindLectureToggle = deps.findOrCreateLectureToggle || findOrCreateLectureToggle;
  const doReplaceChildren = deps.replaceToggleChildren || replaceToggleChildren;

  const config = await doGetConfig();
  if (!config.groqApiKey || !config.notionToken || !config.notionParentPageId) {
    throw new Error('Configure settings first');
  }

  const { brief, bullets } = await doSummarize(transcriptText, config.groqApiKey);

  const cache = await doGetCache(courseTitle);

  const coursePageId = await doFindCoursePage(courseTitle, cache, config.notionToken, config.notionParentPageId);
  await doSetCache(courseTitle, cache);

  await doFindSectionHeading(sectionTitle, coursePageId, cache, config.notionToken);
  await doSetCache(courseTitle, cache);

  const toggleBlockId = await doFindLectureToggle(lectureTitle, coursePageId, cache, config.notionToken);
  await doSetCache(courseTitle, cache);

  await doReplaceChildren(toggleBlockId, brief, bullets, config.notionToken);

  return { brief, bullets };
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'SAVE_NOTES') return false;

    saveNotes(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests in `background.test.js`, plus all prior tests)

- [ ] **Step 5: Commit**

```bash
git add src/background.js tests/background.test.js
git commit -m "feat: wire background orchestration for save-notes flow"
```

---

### Task 5: content-script.js (Udemy scraping + button injection)

**Files:**
- Create: `src/content-script.js`

**Interfaces:**
- Consumes: sends `chrome.runtime.sendMessage({type: 'SAVE_NOTES', payload})` matching the shape `background.js` (Task 4) expects, and reads the `{ok, result, error}` response shape it returns.
- Produces: nothing consumed by other files — this is the outermost UI layer. No automated tests (see rationale below); verified manually against a live Udemy course.

This task has no unit tests: it manipulates real Udemy page DOM (transcript panel, curriculum sidebar, player controls), which only exists on the live site. Per the spec's testing section, this is verified manually end-to-end. Udemy's DOM structure was not inspected live while writing this plan, so the selectors below are best-effort based on Udemy's commonly documented `data-purpose` attribute convention — Step 4 requires opening a real Udemy course and adjusting any selector that doesn't match.

- [ ] **Step 1: Write `src/content-script.js`**

```javascript
function getTranscriptText() {
  const cueNodes = document.querySelectorAll('[data-purpose="transcript-cue"]');
  if (cueNodes.length === 0) return null;
  return Array.from(cueNodes)
    .map((node) => node.textContent.trim())
    .filter(Boolean)
    .join(' ');
}

async function ensureTranscriptPanelOpen() {
  if (document.querySelector('[data-purpose="transcript-cue"]')) return true;

  const toggleButton = document.querySelector('[data-purpose="transcript-toggle"]');
  if (!toggleButton) return false;

  toggleButton.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return Boolean(document.querySelector('[data-purpose="transcript-cue"]'));
}

function getCourseTitle() {
  const el = document.querySelector('[data-purpose="course-header-title"]') || document.querySelector('h1');
  return el ? el.textContent.trim() : 'Untitled Course';
}

function getLectureTitle() {
  const el = document.querySelector('[data-purpose="curriculum-item-title"][aria-current="true"]') ||
    document.querySelector('[data-purpose="course-lecture-title"]');
  return el ? el.textContent.trim() : document.title;
}

function getSectionTitle() {
  const activeItem = document.querySelector('[data-purpose="curriculum-item-title"][aria-current="true"]');
  if (!activeItem) return 'Section';
  const sectionContainer = activeItem.closest('[data-purpose^="section-panel"]');
  const heading = sectionContainer ? sectionContainer.querySelector('[data-purpose="section-heading"]') : null;
  return heading ? heading.textContent.trim() : 'Section';
}

function createSaveButton() {
  const button = document.createElement('button');
  button.textContent = 'Save Notes';
  button.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;padding:8px 16px;background:#5624d0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;';
  return button;
}

function showToast(message, isError) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `position:fixed;bottom:60px;right:16px;z-index:9999;padding:8px 16px;border-radius:4px;color:#fff;font-size:13px;background:${isError ? '#c0392b' : '#27ae60'};`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

async function handleSaveClick(button) {
  const panelReady = await ensureTranscriptPanelOpen();
  if (!panelReady) {
    showToast('Open the transcript panel first', true);
    return;
  }

  const transcriptText = getTranscriptText();
  if (!transcriptText) {
    showToast('No transcript found for this lecture', true);
    return;
  }

  const payload = {
    courseTitle: getCourseTitle(),
    sectionTitle: getSectionTitle(),
    lectureTitle: getLectureTitle(),
    transcriptText
  };

  button.disabled = true;
  button.textContent = 'Saving...';

  chrome.runtime.sendMessage({ type: 'SAVE_NOTES', payload }, (response) => {
    button.disabled = false;
    button.textContent = 'Save Notes';

    if (!response) {
      showToast('No response from extension background', true);
      return;
    }
    if (!response.ok) {
      if (response.error === 'Configure settings first') {
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      }
      showToast(response.error, true);
      return;
    }
    showToast('Notes saved to Notion', false);
  });
}

function injectButton() {
  if (document.getElementById('udemy-notion-save-button')) return;
  const button = createSaveButton();
  button.id = 'udemy-notion-save-button';
  button.addEventListener('click', () => handleSaveClick(button));
  document.body.appendChild(button);
}

injectButton();
```

- [ ] **Step 2: Add an options-open handler to background.js**

Modify `src/background.js`, adding this alongside the existing `SAVE_NOTES` listener (same `if (typeof chrome !== 'undefined' ...)` block):

```javascript
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'OPEN_OPTIONS') {
      chrome.runtime.openOptionsPage();
    }
  });
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all prior tests still pass — content-script.js has no automated tests)

- [ ] **Step 4: Manual verification against a live Udemy course**

1. Load the extension unpacked (`chrome://extensions` → Developer mode → Load unpacked → select the project folder).
2. Open any Udemy course lecture you're enrolled in.
3. Confirm a "Save Notes" button appears bottom-right.
4. Open the browser DevTools console, inspect the transcript panel and curriculum sidebar elements, and confirm the selectors in Step 1 (`data-purpose="transcript-cue"`, `data-purpose="transcript-toggle"`, `data-purpose="curriculum-item-title"`, etc.) match what's actually rendered. Update any that don't match the real DOM.
5. Click "Save Notes" before configuring settings — confirm the toast shows "Configure settings first" and the options page opens.

- [ ] **Step 5: Commit**

```bash
git add src/content-script.js src/background.js
git commit -m "feat: add Udemy transcript scraping and save-notes button"
```

---

### Task 6: options.html / options.js (settings UI)

**Files:**
- Create: `src/options.html`
- Create: `src/options.js`

**Interfaces:**
- Consumes: `getConfig`, `setConfig` from `src/storage.js` (Task 1).
- Produces: nothing consumed by other files — this is a leaf UI page reachable via `manifest.json`'s `options_page` and via `chrome.runtime.openOptionsPage()` (Task 5).

- [ ] **Step 1: Write `src/options.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Udemy Notes to Notion — Settings</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 24px auto; }
    label { display: block; margin-top: 12px; font-weight: bold; }
    input { width: 100%; padding: 6px; margin-top: 4px; box-sizing: border-box; }
    button { margin-top: 16px; padding: 8px 16px; }
    #status { margin-top: 12px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Settings</h1>
  <label for="groqApiKey">Groq API key</label>
  <input id="groqApiKey" type="password" />

  <label for="notionToken">Notion integration token</label>
  <input id="notionToken" type="password" />

  <label for="notionParentPageId">Notion parent page ID</label>
  <input id="notionParentPageId" type="text" placeholder="paste the page ID or URL you shared with your integration" />

  <button id="saveButton">Save</button>
  <div id="status"></div>

  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `src/options.js`**

```javascript
import { getConfig, setConfig } from './storage.js';

function extractPageId(input) {
  const match = input.match(/[0-9a-fA-F]{32}|[0-9a-fA-F-]{36}/);
  return match ? match[0] : input.trim();
}

async function load() {
  const config = await getConfig();
  document.getElementById('groqApiKey').value = config.groqApiKey;
  document.getElementById('notionToken').value = config.notionToken;
  document.getElementById('notionParentPageId').value = config.notionParentPageId;
}

async function save() {
  const config = {
    groqApiKey: document.getElementById('groqApiKey').value.trim(),
    notionToken: document.getElementById('notionToken').value.trim(),
    notionParentPageId: extractPageId(document.getElementById('notionParentPageId').value)
  };
  await setConfig(config);
  const status = document.getElementById('status');
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

document.getElementById('saveButton').addEventListener('click', save);
load();
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm test`
Expected: PASS (all prior tests still pass — options.js is a leaf UI file with no automated tests)

- [ ] **Step 4: Manual verification**

1. Reload the unpacked extension in `chrome://extensions`.
2. Right-click the extension icon → Options (or trigger it via the "Configure settings first" flow from Task 5).
3. Enter a Groq API key, a Notion integration token, and either a raw Notion page ID or a full Notion page URL in the parent-page field.
4. Click Save, confirm "Saved." appears, close and reopen the options page, confirm the values persisted.
5. Paste a full Notion URL like `https://www.notion.so/myworkspace/My-Page-abcdef1234567890abcdef1234567890` into the parent-page field, save, reopen, and confirm only the 32-character ID was extracted and stored.

- [ ] **Step 5: Commit**

```bash
git add src/options.html src/options.js
git commit -m "feat: add settings page for Groq and Notion credentials"
```

---

### Task 7: End-to-end verification + README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing (documentation only).

- [ ] **Step 1: Write `README.md`**

```markdown
# Udemy Notes to Notion

Chrome extension that summarizes a Udemy lecture's transcript (via Groq) and
saves a brief + bullet notes into a structured Notion page, organized by
course → section → lecture.

## Setup

1. **Groq API key** — sign up at https://console.groq.com and create an API key.
2. **Notion integration** — go to https://www.notion.so/my-integrations, create a
   new internal integration, copy its token. Then open the Notion page you
   want course notes created under, click "..." → "Connections" → add your
   integration, and copy that page's ID or URL.
3. Load this folder as an unpacked extension: `chrome://extensions` →
   enable Developer mode → "Load unpacked" → select this folder.
4. Open the extension's options page (right-click its toolbar icon →
   Options), paste in your Groq key, Notion token, and Notion parent page,
   and click Save.

## Usage

1. Open any Udemy lecture, open its transcript panel.
2. Click the "Save Notes" button (bottom-right of the page).
3. The lecture's brief + bullet notes appear as a toggle block in Notion,
   under a heading for the lecture's section, under a page for the course.
4. Re-clicking "Save Notes" on the same lecture updates its existing toggle
   instead of creating a duplicate.

## Development

Run unit tests: `npm test`
```

- [ ] **Step 2: Run the full test suite one final time**

Run: `npm test`
Expected: PASS (all tests across `storage.test.js`, `groq-client.test.js`, `notion-client.test.js`, `background.test.js`)

- [ ] **Step 3: Full manual end-to-end verification**

1. With settings configured (Task 6), open a real Udemy course lecture with captions.
2. Click "Save Notes". Confirm the toast shows "Notes saved to Notion".
3. Open Notion, confirm: a page named after the course exists, containing a heading for the current section, a divider, and a toggle named after the lecture with a brief paragraph and bullet list inside.
4. Navigate to a second lecture in the same section, click "Save Notes". Confirm a second toggle is added under the same section heading (no duplicate heading/divider).
5. Re-click "Save Notes" on the first lecture again. Confirm its toggle's contents are replaced in place — no duplicate toggle, no duplicate children inside it.
6. Navigate to a lecture in a different section, click "Save Notes". Confirm a new heading + divider + toggle are added after the existing content on the same course page.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add setup and usage instructions"
```
