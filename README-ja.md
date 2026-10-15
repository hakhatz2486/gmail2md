# gmail2md

[English](https://github.com/hakhatz2486/gmail2md/blob/main/README.md) | 日本語

Gmailで開いているスレッドをMarkdownに変換し、クリップボードにコピーするユーザースクリプトです。
MCPで接続できないGmailアカウントのメールでも、LLMに貼り付けて読ませられます。

## 機能

- スレッドの全メッセージを展開し、件名、日時、送信者、To、Cc、Bcc、添付ファイル名、本文をMarkdownにまとめます。
- 返信時に付く過去メールの引用を取り除きます。転送されたメールの内容は残します。
- 開封確認用の画像や非表示のテキストを取り除き、表、見出し、リンクをMarkdownの書式に変換します。
- 下書きはコピーしません。
- GmailのSPA遷移に追従します。

## 導入

1. [Violentmonkey](https://violentmonkey.github.io/)や[Tampermonkey](https://www.tampermonkey.net/)などのユーザースクリプトマネージャーをブラウザへインストールします。
2. Greasy Forkの[gmail2md](https://greasyfork.org/ja/scripts/600442-gmail2md)からインストールします。
3. `mail.google.com`を再読み込みします。

## 使い方

スレッドを開き、次のいずれかの方法でコピーします。

- 印刷アイコンの右に追加される`Markdownでコピー`ボタンを押す。
- `Alt+M`を押す。
- ユーザースクリプトマネージャーのメニューから`gmail2md: スレッドをコピー`を選ぶ。

コピーが終わると、画面の左下にコピーしたメッセージの件数が表示されます。

出力は次の形式です。

```markdown
# 件名

## 2026-10-13 12:00 山田太郎
- From: 山田太郎 <taro@example.com>
- To: 佐藤花子 <hanako@example.com>
- Cc: 鈴木一郎 <ichiro@example.com>
- Attachments: 資料.pdf

本文
```

## 注意事項

- 1件でもメッセージの取得に失敗した場合は、何もコピーせずに理由を表示します。一部のメッセージが抜けたまま貼り付けることを防ぐためです。
- コピーの際に、すべてのメッセージを展開し、宛先の「詳細を表示」を開閉します。
- 引用要素を使わずに本文へ含められた過去のメールや、Outlook形式の引用は取り除きません。
- 日本語表示のGmailで動作を確認しています。他の言語の表示では、日時を読み取れない場合があります。
- `Alt+M`がブラウザや他のソフトウェアのショートカットと重なる場合は、ボタンかメニューを使ってください。
- Gmailの画面構造が変更されると、動作しなくなる場合があります。
- 本スクリプトはGmailの画面を読み取るもので、Gmail APIは使用しません。コピーした内容は外部に送信しません。

## 変更履歴

[CHANGELOG-ja.md](https://github.com/hakhatz2486/gmail2md/blob/main/CHANGELOG-ja.md)を参照してください。

## ライセンス

[MIT License](https://github.com/hakhatz2486/gmail2md/blob/main/LICENSE)
