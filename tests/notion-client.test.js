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
  const cache = { pageId: 'p', sections: { 'Section 1': { headingBlockId: 'h1', lastBlockId: 'd1', lectures: {} } }, lectures: {} };
  let called = false;
  const id = await findOrCreateSectionHeading('Section 1', 'p', cache, 'token', async () => { called = true; });
  assert.equal(id, 'h1');
  assert.equal(called, false);
});

test('findOrCreateSectionHeading creates heading+divider and caches heading id and lastBlockId', async () => {
  const cache = { pageId: 'p', sections: {}, lectures: {} };
  let capturedBody;
  const fakeFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ results: [{ id: 'heading-id' }, { id: 'divider-id' }] }) };
  };
  const id = await findOrCreateSectionHeading('Intro', 'p', cache, 'token', fakeFetch);
  assert.equal(id, 'heading-id');
  assert.equal(cache.sections['Intro'].headingBlockId, 'heading-id');
  assert.equal(cache.sections['Intro'].lastBlockId, 'divider-id');
  assert.deepEqual(cache.sections['Intro'].lectures, {});
  assert.equal(capturedBody.children[0].type, 'heading_2');
  assert.equal(capturedBody.children[1].type, 'divider');
});

test('findOrCreateLectureToggle creates a toggle, caches it under its section, and advances lastBlockId', async () => {
  const cache = { pageId: 'p', sections: { 'Intro': { headingBlockId: 'h1', lastBlockId: 'divider-id', lectures: {} } }, lectures: {} };
  const id = await findOrCreateLectureToggle('Lecture 1', 'Intro', 'p', cache, 'token', async () => ({ ok: true, json: async () => ({ results: [{ id: 'toggle-id' }] }) }));
  assert.equal(id, 'toggle-id');
  assert.equal(cache.sections['Intro'].lectures['Lecture 1'].toggleBlockId, 'toggle-id');
  assert.equal(cache.sections['Intro'].lastBlockId, 'toggle-id');
});

test('findOrCreateLectureToggle anchors a new toggle after the section current lastBlockId', async () => {
  const cache = { pageId: 'p', sections: { 'Intro': { headingBlockId: 'h1', lastBlockId: 'divider-id', lectures: {} } }, lectures: {} };
  let capturedBody;
  const fakeFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ results: [{ id: 'toggle-id' }] }) };
  };
  await findOrCreateLectureToggle('Lecture 1', 'Intro', 'p', cache, 'token', fakeFetch);
  assert.equal(capturedBody.after, 'divider-id');
});

test('findOrCreateLectureToggle returns cached id without calling fetch on a hit', async () => {
  const cache = { pageId: 'p', sections: { 'Intro': { headingBlockId: 'h1', lastBlockId: 'toggle-1', lectures: { 'Lecture 1': { toggleBlockId: 'toggle-1' } } } }, lectures: {} };
  let called = false;
  const id = await findOrCreateLectureToggle('Lecture 1', 'Intro', 'p', cache, 'token', async () => { called = true; });
  assert.equal(id, 'toggle-1');
  assert.equal(called, false);
});

test('findOrCreateLectureToggle keeps same-titled lectures in different sections distinct', async () => {
  const cache = {
    pageId: 'p',
    sections: {
      'Section A': { headingBlockId: 'hA', lastBlockId: 'dividerA', lectures: {} },
      'Section B': { headingBlockId: 'hB', lastBlockId: 'dividerB', lectures: {} }
    },
    lectures: {}
  };
  const fetchA = async () => ({ ok: true, json: async () => ({ results: [{ id: 'toggle-a' }] }) });
  const fetchB = async () => ({ ok: true, json: async () => ({ results: [{ id: 'toggle-b' }] }) });

  const idA = await findOrCreateLectureToggle('Same Title', 'Section A', 'p', cache, 'token', fetchA);
  const idB = await findOrCreateLectureToggle('Same Title', 'Section B', 'p', cache, 'token', fetchB);

  assert.equal(idA, 'toggle-a');
  assert.equal(idB, 'toggle-b');
  assert.equal(cache.sections['Section A'].lectures['Same Title'].toggleBlockId, 'toggle-a');
  assert.equal(cache.sections['Section B'].lectures['Same Title'].toggleBlockId, 'toggle-b');
  assert.notEqual(
    cache.sections['Section A'].lectures['Same Title'].toggleBlockId,
    cache.sections['Section B'].lectures['Same Title'].toggleBlockId
  );
});

test('buildLectureChildren truncates brief and bullets over 2000 characters', () => {
  const longBrief = 'a'.repeat(2500);
  const longBullet = 'b'.repeat(2100);
  const children = buildLectureChildren(longBrief, [longBullet]);
  assert.equal(children[0].paragraph.rich_text[0].text.content.length, 2000);
  assert.ok(children[0].paragraph.rich_text[0].text.content.endsWith('...'));
  assert.equal(children[1].bulleted_list_item.rich_text[0].text.content.length, 2000);
  assert.ok(children[1].bulleted_list_item.rich_text[0].text.content.endsWith('...'));
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
