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
