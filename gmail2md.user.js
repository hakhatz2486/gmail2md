// ==UserScript==
// @name           gmail2md
// @name:ja        gmail2md
// @namespace      https://github.com/hakhatz2486/gmail2md
// @version        0.1.0
// @description    Converts the Gmail thread you are viewing into Markdown and copies it to the clipboard.
// @description:ja Gmailで開いているスレッドをMarkdownに変換し、クリップボードにコピーします。
// @author         hakhatz2486
// @homepageURL    https://github.com/hakhatz2486/gmail2md
// @supportURL     https://github.com/hakhatz2486/gmail2md/issues
// @downloadURL    https://raw.githubusercontent.com/hakhatz2486/gmail2md/main/gmail2md.user.js
// @updateURL      https://raw.githubusercontent.com/hakhatz2486/gmail2md/main/gmail2md.user.js
// @license        MIT
// @match          https://mail.google.com/mail/*
// @icon           https://www.google.com/s2/favicons?sz=64&domain=mail.google.com
// @require        https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js
// @require        https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js
// @grant          GM_setClipboard
// @grant          GM_registerMenuCommand
// @run-at         document-end
// @noframes
// ==/UserScript==

// Gmailのスレッド画面のDOMを読み取り、メタ情報と本文をMarkdownにしてクリップボードへコピーする。
// Gmailの難読化クラス名は変わりやすいため、属性(email、title、jsname、role、download_url)を優先し、属性で特定できない箇所だけクラス名に頼る。
// 1通でも取得できなければ何もコピーしない(一部だけのコピーをLLMに渡すと欠落に気づけないため)。

(() => {
    'use strict';

    const SEL = {
        subject: 'h2[data-thread-perm-id]',
        // jsnameはクラス名より変わりにくく、aria-labelと違って表示言語に依存しない。
        expandAll: 'button[jsname="tRarif"]',
        print: 'button[jsname="lXeq2d"]',
        listItem: '[role="list"] > [role="listitem"]',
        // 展開済みのメッセージにだけ付く。折りたたみ中の行には無い。
        message: '[data-message-id]',
        sender: 'h3 span[email]',
        // 日時のspanはtitleとaltの両方に完全な日時を持つ。添付アイコンのimgもtitle+altを持つためspanに限定する。
        date: 'span[title][alt]',
        attachment: 'span[download_url]',
        // 以下は属性で特定できないため、長期間変わっていないクラス名を使う。
        body: '.a3s',
        detailsButton: '.ajy',
        trimToggle: '.ajR',
    };

    const EXPAND_TIMEOUT_MS = 15000;
    const DETAILS_TIMEOUT_MS = 3000;
    const BUTTON_CLASS = 'gmail2md-button';
    const TOAST_ID = 'gmail2md-toast';
    // Material Symbolsのcontent_copy。Gmailのアイコンと同じviewBox(0 -960 960 960)に合わせている。
    const ICON_PATH = 'M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z';
    const BUTTON_LABEL = 'Markdownでコピー';

    class Gmail2mdError extends Error {}

    const fail = (message) => {
        throw new Gmail2mdError(message);
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Gmailは過去に開いた画面を非表示のままDOMに残すため、表示中の要素だけを対象にする。
    const isVisible = (el) => el.getClientRects().length > 0;

    async function waitFor(check, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const result = check();
            if (result) return result;
            if (Date.now() > deadline) return null;
            await sleep(100);
        }
    }

    // スレッド画面

    function findThread() {
        const subject = [...document.querySelectorAll(SEL.subject)].find(isVisible);
        if (!subject) fail('スレッドが開かれていません');
        // 件名とメッセージ一覧は兄弟関係にないため、一覧を含むまで祖先をたどる。
        let view = subject.parentElement;
        while (view && !view.querySelector(SEL.listItem)) view = view.parentElement;
        if (!view) fail('メッセージ一覧が見つかりません');
        return { subject, view };
    }

    const listItems = (view) => [...view.querySelectorAll(SEL.listItem)].filter((item) => !item.parentElement.closest(SEL.body));

    const hasBody = (item) => !!item.querySelector(`${SEL.message} ${SEL.body}`);

    // 本文を持つ行は、返信の編集欄を含んでいても通常のメッセージとして扱う。
    // 下書きは本文の代わりに編集欄を持つか、送信者欄に「下書き」と表示される。
    function isDraft(item) {
        if (hasBody(item)) return false;
        if (item.querySelector('[contenteditable="true"], [g_editable]')) return true;
        return [...item.querySelectorAll('span, font')].some((el) => /^(下書き|Draft)$/.test(el.textContent.trim()));
    }

    // 添付ファイルのカードは本文より遅れて描画されるため、ヘッダーのクリップアイコン(titleにファイル名、altに「添付ファイル」)があればカードの出現を待つ。
    function attachmentsLoaded(item) {
        const msg = item.querySelector(SEL.message);
        if (!msg) return true;
        const hasClip = [...msg.querySelectorAll('img[title][alt]')].some((img) => img.alt && !img.closest(`${SEL.body}, ${SEL.attachment}`));
        return !hasClip || !!msg.querySelector(SEL.attachment);
    }

    // 「すべて展開」は「N件の古いメッセージ」の集約表示も含めて展開し、折りたたみが無くなると消える。
    // そのため、ボタンが消えて全メッセージの本文と添付ファイルが揃った時点を展開完了とみなす。
    async function expandAll(view) {
        const visibleExpandButton = () => [...view.querySelectorAll(SEL.expandAll)].find(isVisible);
        visibleExpandButton()?.click();
        const done = await waitFor(
            () => !visibleExpandButton() && listItems(view).every((item) => isDraft(item) || (hasBody(item) && attachmentsLoaded(item))),
            EXPAND_TIMEOUT_MS,
        );
        if (!done) fail('メッセージの展開がタイムアウトしました');
    }

    // メタ情報

    // 「詳細を表示」の表では`"名前" <addr>`形式の文字列、ヘッダーではname属性に名前が入る。
    function formatAddress(el) {
        const addr = el.getAttribute('email');
        let name = el.getAttribute('name');
        if (!name) {
            const text = el.textContent.trim();
            const match = text.match(/^(.*?)\s*<[^<>]*>$/);
            name = match ? match[1] : text;
        }
        name = name.replace(/^"(.*)"$/, '$1').trim();
        return name && name !== addr ? `${name} <${addr}>` : addr;
    }

    // Gmailのtitleは表示言語ごとに書式が違う(日本語は「2026/08/10 9:04」)。
    // titleはGmailの表示タイムゾーン(ブラウザのローカル)で書かれているので、ローカル時刻として解釈する。
    function parseGmailDate(title) {
        const text = title.replace(/[\u202f\u00a0]/g, ' ');
        const m = text.match(/(\d{4})[/年-](\d{1,2})[/月-](\d{1,2})日?\D*?(\d{1,2}):(\d{2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        const time = Date.parse(text.replace(/\s+at\s+/, ' '));
        if (Number.isNaN(time)) fail(`日時を解釈できません: ${title}`);
        return new Date(time);
    }

    function formatDate(date) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    // 本文中の転送ヘッダーにも「From:」の表があり得るため、本文の外にある表だけを探す。
    function findDetailsTable(msg) {
        return [...msg.querySelectorAll('table')].find(
            (table) => !table.closest(SEL.body) && [...table.rows].some((row) => /^from\s*[:：]/i.test(row.cells[0]?.textContent.trim() ?? '')),
        );
    }

    // To、Cc、Bccを区別して表示するのは「詳細を表示」のポップアップだけで、その表は初めて開いたときに生成される。
    async function readRecipients(msg) {
        let table = findDetailsTable(msg);
        let button = null;
        if (!table) {
            button = msg.querySelector(SEL.detailsButton) ?? fail('「詳細を表示」ボタンが見つかりません');
            button.click();
        }
        try {
            table ??= (await waitFor(() => findDetailsTable(msg), DETAILS_TIMEOUT_MS)) ?? fail('宛先の詳細を取得できません');
            const recipients = { to: [], cc: [], bcc: [] };
            for (const row of table.rows) {
                const key = row.cells[0]?.textContent.trim().match(/^(to|cc|bcc)\s*[:：]/i)?.[1].toLowerCase();
                if (key) recipients[key].push(...[...row.querySelectorAll('span[email]')].map(formatAddress));
            }
            return recipients;
        } finally {
            // 開いたポップアップを残すと画面が崩れるため、同じボタンで閉じる。
            button?.click();
        }
    }

    // download_urlは「MIMEタイプ:URLエンコードされたファイル名:URL」の形式。
    function readAttachments(msg) {
        const names = [...msg.querySelectorAll(SEL.attachment)]
            .filter((el) => !el.closest(SEL.body))
            .map((el) => {
                const encoded = el.getAttribute('download_url').split(':')[1] ?? '';
                try {
                    return decodeURIComponent(encoded);
                } catch {
                    return encoded;
                }
            })
            .filter(Boolean);
        return [...new Set(names)];
    }

    // 本文

    // 返信引用の直前に置かれる帰属行。Gmail日本語版は「2026年8月10日(月) 9:04 名前 <addr>:」のように「書きました」を付けない。
    const ATTRIBUTION_RE = /(wrote|書きました|書き込みました)\s*[:：]?$|<[^<>\s]+@[^<>\s]+>\s*[:：]$/i;

    // 空白、<br>、HTMLコメント、中身の無い要素(トリミングの「…」ボタンを外した後の入れ物など)は帰属行との間に挟まっていても無視する。
    const isBlank = (node) =>
        node.nodeType === Node.COMMENT_NODE ||
        node.nodeName === 'BR' ||
        (!node.textContent.trim() && !(node.nodeType === Node.ELEMENT_NODE && node.querySelector('img')));

    // Gmailはトリミング部分を入れ物で包むため、帰属行がblockquoteの兄弟ではなく祖先の兄弟になることがある。
    // そこで、blockquoteが先頭にある間は親へ上がり、最初に見つかった中身のある直前ノードを帰属行の候補にする。
    function findAttribution(quote, root) {
        for (let node = quote; node !== root; node = node.parentNode) {
            let prev = node.previousSibling;
            while (prev && isBlank(prev)) prev = prev.previousSibling;
            if (!prev) continue;
            if (prev.nodeType === Node.ELEMENT_NODE && prev.matches('.gmail_attr, .moz-cite-prefix')) return prev;
            return ATTRIBUTION_RE.test(prev.textContent.trim()) ? prev : null;
        }
        return null;
    }

    // gmail_quoteは転送内容にも使われるため、クラスでまとめて消さず、帰属行が直前にあるblockquoteだけを返信引用とみなす。
    // Outlook系の引用はblockquoteを使わないので、この判定では残る(仕様どおり)。
    function removeReplyQuotes(root) {
        for (const quote of [...root.querySelectorAll('blockquote')]) {
            if (!root.contains(quote)) continue;
            const attribution = findAttribution(quote, root);
            if (!attribution) continue;
            attribution.remove();
            quote.remove();
        }
    }

    // メールの表の多くはレイアウト用で、turndown-plugin-gfmは見出し行の無い表を生のHTMLのまま残すため、変換前に扱いを決める。
    // 入れ子・1行・1列・role=presentationの表はレイアウト用とみなしてセルを順に並べ、それ以外は先頭行を見出しにしてGFMの表にする。
    function normalizeTables(root) {
        for (const table of [...root.querySelectorAll('table')]) {
            const rows = [...table.rows];
            const columns = Math.max(0, ...rows.map((row) => row.cells.length));
            const isLayout = table.querySelector('table') || rows.length < 2 || columns < 2 || table.getAttribute('role') === 'presentation';
            if (isLayout) {
                const cells = rows.flatMap((row) => [...row.cells]).map((cell) => {
                    const div = document.createElement('div');
                    div.append(...cell.childNodes);
                    return div;
                });
                table.replaceWith(...cells);
            } else if (rows[0].parentElement.nodeName !== 'THEAD') {
                const thead = document.createElement('thead');
                thead.append(rows[0]);
                table.prepend(thead);
            }
        }
    }

    function createTurndown() {
        const service = new TurndownService({
            headingStyle: 'atx',
            bulletListMarker: '-',
            codeBlockStyle: 'fenced',
        });
        service.use(turndownPluginGfm.gfm);
        service.remove(['style', 'script', 'title', 'meta']);
        // メッセージ境界の##と衝突させないため、本文の見出しは2段下げる。
        service.addRule('heading', {
            filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
            replacement: (content, node) => `\n\n${'#'.repeat(Math.min(Number(node.nodeName[1]) + 2, 6))} ${content.trim()}\n\n`,
        });
        service.addRule('image', {
            filter: 'img',
            replacement: (content, node) => {
                // Gmailは絵文字を画像に置き換え、元の文字をdata-emojiに残す。
                const emoji = node.getAttribute('data-emoji');
                if (emoji) return emoji;
                const alt = (node.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim();
                return alt ? `[画像: ${alt}]` : '[画像]';
            },
        });
        // turndown-plugin-gfmのセルは改行をそのまま出して表が壊れるため、1行にまとめ、区切り文字の|もエスケープする。
        service.addRule('tableCell', {
            filter: ['th', 'td'],
            replacement: (content, node) => {
                const prefix = node.parentNode.firstElementChild === node ? '| ' : ' ';
                return `${prefix}${content.replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|').trim()} |`;
            },
        });
        return service;
    }

    let turndown = null;

    const INVISIBLE_RE = /[\u00ad\u034f\u200b\u2060\ufeff]/g;

    // 「…」で隠れたトリミング部分も非表示なだけでDOMには入っているため、クローンを変換すれば展開操作は要らない。
    function convertBody(bodyEl) {
        const root = bodyEl.cloneNode(true);
        // 開封確認用の1px画像は内容を持たないので出力しない。大きさの属性を持たないことが多いため、描画済みの元要素で確かめる。
        // 元とクローンのimgを順番で対応させるので、クローンを変更する前に行う。
        const clonedImages = root.querySelectorAll('img');
        bodyEl.querySelectorAll('img').forEach((img, i) => {
            if (img.complete && img.naturalWidth === 1 && img.naturalHeight === 1) clonedImages[i].remove();
        });
        root.querySelectorAll(SEL.trimToggle).forEach((el) => el.remove());
        // メルマガのプレヘッダーやPC/スマホ版の出し分けは、style属性のdisplay:noneで隠した要素に入っている。
        // Gmail自身のトリミング部分はクラスで隠しているので、ここでは消えない。
        root.querySelectorAll('[style]').forEach((el) => {
            if (/display\s*:\s*none/i.test(el.getAttribute('style'))) el.remove();
        });
        removeReplyQuotes(root);
        normalizeTables(root);
        turndown ??= createTurndown();
        return (
            turndown
                .turndown(root)
                // メルマガが行の高さ調整やプレヘッダーの埋め草に使う不可視文字。絵文字の結合に使うZWJ(U+200D)は残す。
                .replace(INVISIBLE_RE, '')
                // <br>はMarkdownの強制改行(行末スペース2つ)になるが、LLMに貼る用途では不要なので消す。
                // brオプションを空にすると連続した<br>が1つの改行にまとめられて段落の空行が消えるため、出力後に消している。
                .replace(/[ \t\u00a0]+$/gm, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim()
        );
    }

    // 組み立て

    async function readMessage(item) {
        const msg = item.querySelector(SEL.message);
        const sender = msg.querySelector(SEL.sender) ?? fail('送信者を取得できません');
        const dateEl = msg.querySelector(SEL.date) ?? fail('日時を取得できません');
        const bodyEl = msg.querySelector(SEL.body) ?? fail('本文を取得できません');
        return {
            date: formatDate(parseGmailDate(dateEl.getAttribute('title'))),
            senderName: sender.getAttribute('name')?.trim() || sender.getAttribute('email'),
            from: formatAddress(sender),
            ...(await readRecipients(msg)),
            attachments: readAttachments(msg),
            body: convertBody(bodyEl),
        };
    }

    function formatMessage(m) {
        const lines = [`## ${m.date} ${m.senderName}`, `- From: ${m.from}`];
        if (m.to.length) lines.push(`- To: ${m.to.join(', ')}`);
        if (m.cc.length) lines.push(`- Cc: ${m.cc.join(', ')}`);
        if (m.bcc.length) lines.push(`- Bcc: ${m.bcc.join(', ')}`);
        if (m.attachments.length) lines.push(`- Attachments: ${m.attachments.join(', ')}`);
        return m.body ? `${lines.join('\n')}\n\n${m.body}` : lines.join('\n');
    }

    async function buildMarkdown() {
        const { subject, view } = findThread();
        await expandAll(view);
        const items = listItems(view).filter((item) => !isDraft(item));
        if (!items.length) fail('メッセージが見つかりません');
        const messages = [];
        // 詳細ポップアップの開閉が重ならないよう、1通ずつ順に読む。
        for (const item of items) messages.push(await readMessage(item));
        const title = subject.textContent.replace(/\s+/g, ' ').trim();
        return { text: `# ${title}\n\n${messages.map(formatMessage).join('\n\n')}\n`, count: messages.length };
    }

    // 通知

    function injectStyle() {
        const style = document.createElement('style');
        // 配色はGruvbox Light/Dark Medium。
        style.textContent = `
            #${TOAST_ID} {
                position: fixed;
                left: 24px;
                bottom: 24px;
                z-index: 2147483647;
                max-width: min(480px, calc(100vw - 48px));
                padding: 12px 16px;
                border-radius: 8px;
                border-left: 4px solid #79740e;
                background: #fbf1c7;
                color: #3c3836;
                box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
                font: 14px/1.5 "Google Sans", Roboto, sans-serif;
            }
            #${TOAST_ID}.error {
                border-left-color: #9d0006;
            }
            @media (prefers-color-scheme: dark) {
                #${TOAST_ID} {
                    border-left-color: #b8bb26;
                    background: #282828;
                    color: #ebdbb2;
                }
                #${TOAST_ID}.error {
                    border-left-color: #fb4934;
                }
            }
        `;
        document.head.append(style);
    }

    let toastTimer = 0;

    function toast(message, isError = false) {
        document.getElementById(TOAST_ID)?.remove();
        clearTimeout(toastTimer);
        const el = document.createElement('div');
        el.id = TOAST_ID;
        el.className = isError ? 'error' : '';
        el.setAttribute('role', isError ? 'alert' : 'status');
        el.textContent = message;
        document.body.append(el);
        toastTimer = setTimeout(() => el.remove(), isError ? 6000 : 3000);
    }

    // 起動

    let running = false;

    async function copyThread() {
        // 展開や詳細ポップアップの操作が並行すると互いの待機条件を壊すため、多重起動を防ぐ。
        if (running) return;
        running = true;
        try {
            const { text, count } = await buildMarkdown();
            GM_setClipboard(text, 'text/plain');
            toast(`${count}件のメッセージをコピーしました`);
        } catch (error) {
            toast(error instanceof Gmail2mdError ? error.message : `コピーに失敗しました: ${error.message}`, true);
            if (!(error instanceof Gmail2mdError)) console.error('[gmail2md]', error);
        } finally {
            running = false;
        }
    }

    // 印刷ボタンを複製して見た目(サイズ、ホバー時の背景)をGmailに合わせる。
    // js*属性を残すとGmailのイベント処理が複製元と同じ動作(印刷)を起こすため取り除く。
    function createButton(printButton) {
        const button = printButton.cloneNode(true);
        for (const el of [button, ...button.querySelectorAll('*')]) {
            for (const { name } of [...el.attributes]) {
                if (/^(js|data-tooltip|id$|aria-describedby$)/.test(name)) el.removeAttribute(name);
            }
        }
        button.querySelector('svg path')?.setAttribute('d', ICON_PATH);
        button.classList.add(BUTTON_CLASS);
        button.setAttribute('aria-label', BUTTON_LABEL);
        button.setAttribute('data-tooltip', BUTTON_LABEL);
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            copyThread();
        });
        return button;
    }

    // 印刷ボタンはスレッド画面にだけあり、SPA遷移のたびに作り直されるので、その隣に毎回挿入し直す。
    function ensureButtons() {
        for (const printButton of document.querySelectorAll(SEL.print)) {
            if (printButton.parentElement.querySelector(`.${BUTTON_CLASS}`)) continue;
            printButton.after(createButton(printButton));
        }
    }

    // requestAnimationFrameで間引くと裏のタブでは呼ばれず、遷移直後にボタンが無い状態が生じるため、変更のたびに直接確認する。
    // MutationObserverの通知はまとめて届き、確認もセレクタ1回で済むので負荷は小さい。
    function observe() {
        new MutationObserver(ensureButtons).observe(document.body, { childList: true, subtree: true });
        ensureButtons();
    }

    function onKeyDown(event) {
        if (event.code !== 'KeyM' || !event.altKey || event.ctrlKey || event.shiftKey || event.metaKey || event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        copyThread();
    }

    injectStyle();
    observe();
    window.addEventListener('keydown', onKeyDown, true);
    GM_registerMenuCommand('gmail2md: スレッドをコピー', copyThread);
})();
