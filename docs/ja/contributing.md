# コントリビュート

Pull Request を作成する前に、リポジトリの[貢献ガイド](https://github.com/illusions-lab/milkdown-plugin-mdi/blob/main/CONTRIBUTING.md)を読んでください。

提出前に関連する検証を実行します。

```bash
npm test
npm run test:coverage
npm run typecheck
npm run docs:build
npm run test:browser
npm run test:tarball
npm run test:consumer
```

`test:browser` はローカルでは Chromium を実行します。Playwright の全ブラウザを
インストールしている場合は `npm run test:browser:all` を実行してください。

英語版と日本語版のドキュメントは同期してください。MDI 文法またはその解釈の変更は、公式の [MDI 構文リファレンス](https://mdi.illusions.app/ja/syntax/reference/)にリンクしてください。このリポジトリは Milkdown 統合とテスト済みの対応範囲を説明します。
