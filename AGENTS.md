# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## What this is

A single-file Violentmonkey userscript (`gmail2md.user.js`) that converts the Gmail thread currently open into Markdown and copies it to the clipboard, so that mail from Gmail accounts that cannot be connected via MCP can be pasted into an LLM. It reads Gmail's rendered DOM rather than calling any API. HTML-to-Markdown conversion is done by Turndown and turndown-plugin-gfm, loaded via `@require` from jsDelivr. There is no build system, package manager, linter, or test suite; the entire project is the one `.user.js` file.

## Development workflow

There are no build/lint/test commands. Development means editing `gmail2md.user.js` directly and verifying behavior manually on `mail.google.com`:

1. Load the script into Violentmonkey (Chrome or Brave).
2. Open a thread and run the copy from each entry point: the button next to the print icon, `Alt+M`, and the Violentmonkey menu command.
3. Check the resulting Markdown against the thread: message count, headers, recipients (To/Cc/Bcc), attachments, quote removal, and that the details popups and expanded state do not break the page.

Gmail enforces Trusted Types (`require-trusted-types-for 'script'`). Never build DOM with `innerHTML` or parse HTML strings; pass DOM nodes to Turndown (it clones them) and create elements with `createElement`. Injecting test code into a Gmail tab from DevTools also needs a Trusted Types policy for `eval`.

Gmail's obfuscated class names change over time. When a selector breaks, re-inspect the live DOM and prefer attributes (`email`, `name`, `title`, `jsname`, `role`, `data-message-id`, `download_url`) over classes. Only the body container (`.a3s`), the "Show details" button (`.ajy`), and the trimmed-content toggle (`.ajR`) rely on class names, because no stable attribute was found for them.

Releases are distributed through Greasy Fork (script ID 600442, currently unlisted). `@homepageURL`, `@downloadURL`, and `@updateURL` point to Greasy Fork, following the other userscripts by the same author (`hakhatz2486/x-one-click-button`, `hakhatz2486/claude-logo-replacer`); `@supportURL` stays on GitHub Issues. Bump `@version` for every user-facing change, otherwise installed copies are not updated.

## Architecture

Everything lives inside one IIFE. `copyThread()` is the single entry point shared by all three triggers, guarded by a `running` flag so that expansion and popup handling never run concurrently. Errors are thrown as `Gmail2mdError` via `fail()`; any failure aborts the whole copy, because a partial copy would silently drop messages from what the LLM sees.

- `SEL` holds every Gmail selector. Start here when Gmail's DOM changes.
- `findThread()` finds the visible subject (`h2[data-thread-perm-id]`) and walks up to the nearest ancestor containing the message list. Gmail keeps previously opened views hidden in the DOM, so visibility (`getClientRects()`) is checked.
- `expandAll()` clicks "Expand all" (`button[jsname="tRarif"]`), which also expands the "N older messages" group, and waits until that button disappears and every non-draft list item has a body and its attachment cards. Attachment cards render after the body; a message has attachments if its header shows the paperclip `img[title][alt]`.
- `readRecipients()` opens the per-message "Show details" popup, because only that table separates To/Cc/Bcc. Gmail creates the table on first open, so the script waits for it, reads rows by their `From:`/`To:`/`Cc:`/`Bcc:` labels, and clicks the button again to close it.
- `parseGmailDate()` reads the absolute date from the date span's `title` (Japanese UI: `2026/08/10 9:04`), interpreted as local time.
- `convertBody()` clones the body, then in this order: removes 1px tracking images (checked against the rendered originals by index, so it must run before any other mutation), removes the trim toggle and inline `display:none` elements, removes reply quotes, normalizes tables, and runs Turndown.
    - Trimmed content ("...") is already in the DOM inside Gmail's hidden wrappers, so no click is needed.
    - `removeReplyQuotes()` removes a `blockquote` only when an attribution line precedes it (`.gmail_attr`, `.moz-cite-prefix`, or text ending in "wrote:" / "書きました" / `<addr>:`). Gmail wraps trimmed quotes, so `findAttribution()` climbs to ancestors while the quote is their first meaningful child. `gmail_quote` is not removed wholesale because forwarded content uses it too. Outlook-style quotes are intentionally kept.
    - `normalizeTables()` exists because turndown-plugin-gfm keeps tables without a heading row as raw HTML. Nested, single-row, single-column, and `role="presentation"` tables are flattened into divs; others get their first row moved into a `thead`.
    - Custom Turndown rules shift headings down two levels (h1 becomes `###`) so they do not collide with the `##` message headings, replace images with `[画像: alt]`, and keep table cells on one line.
- `ensureButtons()` clones Gmail's print button (`button[jsname="lXeq2d"]`) to match its look, strips `js*` attributes so Gmail's event delegation does not trigger printing, and inserts it after the print button. A `MutationObserver` calls it directly on every mutation; throttling with `requestAnimationFrame` was dropped because it does not fire in background tabs.

## Unverified behavior

These were not testable with the author's account when the script was written. Verify them on the live site before relying on them or changing related code:

- Collapsed "N older messages" groups in long threads.
- Draft detection (`isDraft()`), which assumes drafts show an editor or a "下書き"/"Draft" label instead of a body.
- Date parsing with a non-Japanese Gmail UI.
- Conflicts of `Alt+M` with Brave or AutoHotkey.
