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
