const TRANSCRIPT_CUE_SELECTOR = '[data-purpose="transcript-cue"], [data-purpose="transcript-cue-active"]';

function getTranscriptText() {
  const cueNodes = document.querySelectorAll(TRANSCRIPT_CUE_SELECTOR);
  if (cueNodes.length === 0) return null;
  return Array.from(cueNodes)
    .map((node) => node.textContent.trim())
    .filter(Boolean)
    .join(' ');
}

async function ensureTranscriptPanelOpen() {
  if (document.querySelector(TRANSCRIPT_CUE_SELECTOR)) return true;

  const toggleButton = document.querySelector('[data-purpose="transcript-toggle"]');
  if (!toggleButton) return false;

  toggleButton.click();
  await new Promise((resolve) => setTimeout(resolve, 500));
  return Boolean(document.querySelector(TRANSCRIPT_CUE_SELECTOR));
}

// The player labels the active lecture's section with an aria-label like
// "Section 3: Accessing LLMs in Python, Lecture 10: Ollama (Open-Source & Local)".
// That's a more reliable source than the curriculum sidebar, whose data-purpose
// attributes Udemy has changed repeatedly (and which requires the sidebar open).
function getCurriculumLabelParts() {
  const el = document.querySelector('[data-purpose="curriculum-item-viewer-content"] [aria-label]');
  const label = el ? el.getAttribute('aria-label') : null;
  if (!label) return null;
  const match = label.match(/^Section\s+\d+:\s*(.+?),\s*Lecture\s+\d+:\s*(.+)$/i);
  return match ? { sectionTitle: match[1].trim(), lectureTitle: match[2].trim() } : null;
}

function getCourseTitle() {
  const el = document.querySelector('[data-purpose="course-header-title"] a') ||
    document.querySelector('[data-purpose="course-header-title"]') ||
    document.querySelector('h1');
  return el ? el.textContent.trim() : 'Untitled Course';
}

function getLectureTitle() {
  const fromLabel = getCurriculumLabelParts();
  if (fromLabel) return fromLabel.lectureTitle;

  const el = document.querySelector('[data-purpose="curriculum-item-title"][aria-current="true"]') ||
    document.querySelector('[data-purpose="course-lecture-title"]');
  return el ? el.textContent.trim() : document.title;
}

function getSectionTitle() {
  const fromLabel = getCurriculumLabelParts();
  if (fromLabel) return fromLabel.sectionTitle;

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
