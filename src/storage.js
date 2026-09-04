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
