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
