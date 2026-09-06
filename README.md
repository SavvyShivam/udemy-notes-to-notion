# Udemy Notes to Notion

Chrome extension that summarizes a Udemy lecture's transcript (via Groq) and
saves a brief + bullet notes into a structured Notion page, organized by
course → section → lecture.

## Screenshots

| Save Notes on a lecture | Notes saved in Notion | Settings page |
|---|---|---|
| ![Save Notes button on a Udemy lecture](screenshots/udemy-lecture-transcript.png) | ![Saved notes as a toggle block in Notion](screenshots/notion-saved-notes.png) | ![Extension settings page](screenshots/options-page.png) |

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

   Note: API keys are not validated when saved — the first sign of a bad
   key is an error toast when clicking "Save Notes" on a lecture.

## Usage

1. Open any Udemy lecture, open its transcript panel.
2. Click the "Save Notes" button (bottom-right of the page).
3. The lecture's brief + bullet notes appear as a toggle block in Notion,
   under a heading for the lecture's section, under a page for the course.
4. Re-clicking "Save Notes" on the same lecture updates its existing toggle
   instead of creating a duplicate.

### How notes are organized in Notion

Point the extension at one parent page you'll reuse forever (e.g. "Udemy
Learning"). Every course you save notes from gets its own page underneath
it, created automatically the first time you use the button on that course —
you never have to touch settings again. Sections and lectures then just
accumulate inside that course's page as you work through it:

```
Udemy Learning (your parent page)
 ├─ Complete Generative AI Course: RAG, AI Agents & Deployment
 │   ├─ Section: Accessing LLMs in Python
 │   │   └─ ▸ Ollama (Open-Source & Local)
 │   └─ Section: ...
 ├─ Some Other Course You Take Later
 │   └─ Section: ...
 └─ ...
```

## Development

Run unit tests: `npm test`

Regenerate the toolbar/store icons (`icons/icon{16,48,128}.png`):
`node scripts/generate-icons.js` (placeholder branding — swap in real artwork
by replacing those PNGs directly whenever you have a logo).

## Privacy

No data is collected by the developer. Your API keys stay in your browser's
local storage and are used only to talk directly to Groq/Notion on your
behalf. See [PRIVACY.md](PRIVACY.md).

## License

MIT — see [LICENSE](LICENSE).
