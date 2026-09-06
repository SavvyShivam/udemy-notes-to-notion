# Privacy Policy — Udemy Notes to Notion

**Last updated:** 2026-09-06

This extension does not collect, transmit, or sell any user data to its
developer or any third party.

## What it stores

Your Groq API key, Notion integration token, and Notion parent page ID are
saved only in your browser's local extension storage (`chrome.storage.local`)
on your own device. They are never sent anywhere except directly from your
browser to:

- **api.groq.com** — to summarize a lecture transcript you explicitly
  requested notes for.
- **api.notion.com** — to create/update pages in your own Notion workspace.

The extension also caches Notion page/block IDs locally so it can find your
existing course notes instead of duplicating them. This cache never leaves
your device either.

## What it reads

The content script reads the transcript text and lecture/course/section
titles from the Udemy lecture page you are currently viewing, only when you
click "Save Notes." It does not run on any other site, and does not track
your browsing.

## Third parties

Requests to Groq and Notion are subject to their own privacy policies:

- https://groq.com/privacy-policy/
- https://www.notion.so/privacy

## Contact

Open an issue on the GitHub repository for this extension.
