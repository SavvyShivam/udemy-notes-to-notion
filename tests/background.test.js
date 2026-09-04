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
