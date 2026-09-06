const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_VERSION
  };
}

function truncate(text) {
  return text.length > 2000 ? text.slice(0, 1997) + '...' : text;
}

export function buildLectureChildren(brief, bullets) {
  const children = [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: truncate(brief) } }] }
    }
  ];
  for (const bullet of bullets) {
    children.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [{ type: 'text', text: { content: truncate(bullet) } }] }
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
  const dividerBlockId = data.results[1].id;
  cache.sections[sectionTitle] = { headingBlockId, lastBlockId: dividerBlockId, lectures: {} };
  return headingBlockId;
}

export async function findOrCreateLectureToggle(lectureTitle, sectionTitle, coursePageId, cache, token, fetchImpl = fetch) {
  const section = cache.sections[sectionTitle];
  if (section.lectures[lectureTitle]) return section.lectures[lectureTitle].toggleBlockId;

  const response = await fetchImpl(`${NOTION_API_URL}/blocks/${coursePageId}/children`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({
      after: section.lastBlockId,
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
  section.lectures[lectureTitle] = { toggleBlockId };
  section.lastBlockId = toggleBlockId;
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
