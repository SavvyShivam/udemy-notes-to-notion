# Udemy → Notion Note Taker (Chrome Extension) — Design

## Purpose

A Chrome extension that, while watching a Udemy lecture, reads the lecture's
transcript, generates a brief summary + bullet notes via an LLM, and pushes
those notes into a structured Notion workspace — organized by course,
section, and lecture — so the user builds a running set of course notes in
Notion without manual copy-paste or note-taking during video playback.

## Scope decision (from brainstorming)

Two product shapes were considered: a subscription SaaS (Cloudflare Worker
backend + hosted LLM + Stripe billing) vs. a bring-your-own-key (BYOK)
personal tool. **This spec covers BYOK only.** The subscription/SaaS variant
is a separate, much larger project (billing, multi-user backend, abuse
handling) and is out of scope here. The design keeps the LLM call isolated
in the background service worker so a hosted-backend swap remains possible
later without touching the content script or Notion logic.

## Non-goals

- No backend/server component. All calls (Groq, Notion) go directly from
  the extension's background service worker to the respective public APIs.
- No multi-provider LLM support. Groq only.
- No OAuth. Notion auth is a user-created internal integration token pasted
  into the extension's settings page.
- No automatic triggering. Notes are generated only when the user clicks
  the injected "Save Notes" button.

## Architecture

Three components, standard MV3 layout:

```
manifest.json
content-script.js   — runs on Udemy lecture pages
background.js       — service worker: Groq calls, Notion calls, ID cache
options.html/js      — settings UI: Groq key, Notion token, parent page
popup.html/js         — (optional) status/last-saved indicator
```

### Content script

- Matches Udemy course-player URLs (`*://*.udemy.com/course/*/learn/*`).
- Locates the transcript panel in the DOM. If not open, attempts to open it
  (click the "Transcript" toggle button); if the panel truly isn't
  available (course has no captions), shows an inline error and does not
  proceed.
- Extracts: course title, current section title, current lecture title,
  and the transcript's full text (concatenated cue text, timestamps
  discarded — brief/bullets don't need timing).
- Injects a "Save Notes" button into the player controls area.
- On click: sends a `SAVE_NOTES` message to the background worker with
  `{ courseTitle, sectionTitle, lectureTitle, transcriptText }`, shows a
  loading state on the button, then a success or error toast based on the
  response.

### Background service worker

Owns all external API calls and the local ID cache — the content script
never talks to Groq or Notion directly.

1. **Summarize** — calls Groq's chat completions endpoint with the
   transcript text, prompting for a short brief (2-3 sentences) followed by
   bullet notes. Returns structured `{ brief: string, bullets: string[] }`
   (model instructed to respond in a fixed delimited format, parsed
   defensively — falls back to treating the whole response as the brief if
   parsing fails, rather than throwing).
2. **Sync to Notion** — given the parsed notes and lecture metadata, walks
   the ID cache (see below) to find-or-create the course page, find-or-create
   the section heading+divider, and find-or-create the lecture toggle, then
   writes/replaces the toggle's children with the brief paragraph + bullet
   list.
3. **ID cache** — `chrome.storage.local`, keyed by course title, storing:
   ```
   {
     "<courseTitle>": {
       pageId: "<notion-page-id>",
       sections: {
         "<sectionTitle>": { headingBlockId: "<id>" }
       },
       lectures: {
         "<lectureTitle>": { toggleBlockId: "<id>" }
       }
     }
   }
   ```
   This is what makes re-saving a lecture idempotent: update the existing
   toggle's children instead of creating a new one. Cache is local-only
   (not synced to Notion); if the user clears extension storage or switches
   machines, the extension will create fresh pages/blocks rather than
   silently colliding with old ones — acceptable for a personal tool.

### Options page

Three fields: Groq API key, Notion integration token, Notion parent page
(paste a page ID or URL — the page the user has already shared with their
integration). Stored in `chrome.storage.local`. A "Test connection" action
validates both keys with a lightweight API call before saving.

## Notion page structure

- **Course** → a Notion page (child of the configured parent page) titled
  with the course name. Created once; its ID is cached.
- **Section** → within the course page: a `heading_2` block with the
  section title, followed by a `divider` block. Created once per section;
  heading block ID cached.
- **Lecture** → a `toggle` block titled with the lecture title, appended
  after its section's divider. Toggle's children: one paragraph block
  (the brief) followed by one bulleted-list-item block per bullet. On
  re-save, existing children are deleted and replaced (Notion API supports
  deleting children by block ID) rather than appended, so re-running
  doesn't duplicate content within a lecture.

## Error handling

- Transcript panel unavailable → inline error on the button, no API calls
  made.
- Groq call fails (bad key, rate limit, network) → toast with the error
  message; nothing written to Notion.
- Notion call fails partway (e.g., course page created but section heading
  write fails) → cache is only updated after each successful step, so a
  retry resumes from wherever it left off rather than duplicating earlier
  work.
- Missing settings (no Groq key or Notion token configured) → button click
  shows "Configure settings first" and opens the options page.

## Testing

- Unit tests (plain JS, e.g. via a lightweight test runner) for the pure
  logic that doesn't need a browser: Groq response parsing into
  `{brief, bullets}`, and Notion request-payload construction from
  `{brief, bullets, titles}`.
- Manual end-to-end verification: load unpacked in Chrome, run against a
  real Udemy course with captions, confirm the Notion page/section/toggle
  structure is created correctly, then re-save the same lecture and confirm
  it updates in place rather than duplicating.
