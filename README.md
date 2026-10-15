# gmail2md

English | [日本語](https://github.com/hakhatz2486/gmail2md/blob/main/README-ja.md)

A userscript that converts the Gmail thread you are viewing into Markdown and copies it to the clipboard.
It lets you paste mail from Gmail accounts that cannot be connected via MCP into an LLM.

## Features

- Expands every message in the thread and collects the subject, date, sender, To, Cc, Bcc, attachment names, and body as Markdown.
- Removes quoted previous messages added by replies, while keeping forwarded content.
- Removes tracking images and hidden text, and converts tables, headings, and links into Markdown.
- Skips drafts.
- Follows Gmail SPA navigation.

## Installation

1. Install a userscript manager such as [Violentmonkey](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/).
2. Install from the [gmail2md](https://greasyfork.org/en/scripts/600442-gmail2md) page on Greasy Fork.
3. Reload `mail.google.com`.

## Usage

Open a thread and copy it in one of the following ways.

- Click the `Markdownでコピー` (Copy as Markdown) button added to the right of the print icon.
- Press `Alt+M`.
- Choose `gmail2md: スレッドをコピー` (Copy thread) from the userscript manager menu.

When the copy finishes, the number of copied messages appears at the bottom left of the screen.

The output looks like this.

```markdown
# Subject

## 2026-10-13 12:00 Taro Yamada
- From: Taro Yamada <taro@example.com>
- To: Hanako Sato <hanako@example.com>
- Cc: Ichiro Suzuki <ichiro@example.com>
- Attachments: document.pdf

Body
```

## Notes

- If any message cannot be read, nothing is copied and the reason is shown. This prevents pasting a thread with missing messages.
- While copying, the script expands all messages and opens and closes each message's "Show details" panel.
- Previous messages included in the body without quote markup, and Outlook-style quotes, are not removed.
- The script has been tested with the Japanese Gmail UI. With other languages, dates may fail to parse.
- If `Alt+M` conflicts with a browser or other software shortcut, use the button or the menu instead.
- The script may stop working if Gmail changes its DOM structure.
- This script reads the Gmail interface and does not use the Gmail API. Copied content is not sent anywhere.

## Changelog

See [CHANGELOG.md](https://github.com/hakhatz2486/gmail2md/blob/main/CHANGELOG.md).

## License

[MIT License](https://github.com/hakhatz2486/gmail2md/blob/main/LICENSE)
