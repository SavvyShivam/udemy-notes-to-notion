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
