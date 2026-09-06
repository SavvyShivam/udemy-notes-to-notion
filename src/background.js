import { getConfig, getCourseCache, setCourseCache } from './storage.js';
import { summarizeTranscript } from './groq-client.js';
import {
  findOrCreateCoursePage,
  findOrCreateSectionHeading,
  findOrCreateLectureToggle,
  replaceToggleChildren
} from './notion-client.js';

// A cached page/block id can go stale if the user deletes or trashes it in Notion
// after we cached it. Notion reports that as a 404 (permanently deleted) or a 400
// "archived ancestor" validation error. Recognize those so we can rebuild instead
// of surfacing a raw API error.
export function isStaleNotionError(error) {
  const message = error.message || '';
  const status = message.match(/error (\d{3}):/)?.[1];
  return status === '404' || (status === '400' && /archived/i.test(message));
}

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

  let cache = await doGetCache(courseTitle);

  const runNotionSteps = async () => {
    const coursePageId = await doFindCoursePage(courseTitle, cache, config.notionToken, config.notionParentPageId);
    await doSetCache(courseTitle, cache);

    await doFindSectionHeading(sectionTitle, coursePageId, cache, config.notionToken);
    await doSetCache(courseTitle, cache);

    const toggleBlockId = await doFindLectureToggle(lectureTitle, sectionTitle, coursePageId, cache, config.notionToken);
    await doSetCache(courseTitle, cache);

    await doReplaceChildren(toggleBlockId, brief, bullets, config.notionToken);
  };

  try {
    await runNotionSteps();
  } catch (error) {
    if (!isStaleNotionError(error)) throw error;
    // ponytail: reset the whole course's cache and rebuild once rather than tracking
    // exactly which node went stale. Upgrade path: reset only the failing subtree
    // (course/section/lecture) if recreating the full course page becomes a real cost.
    cache = { pageId: null, sections: {}, lectures: {} };
    await doSetCache(courseTitle, cache);
    await runNotionSteps();
  }

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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'OPEN_OPTIONS') {
      chrome.runtime.openOptionsPage();
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
}
