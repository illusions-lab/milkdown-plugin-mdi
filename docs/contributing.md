# Contributing

Read the repository [contribution guide](https://github.com/illusions-lab/milkdown-plugin-mdi/blob/main/CONTRIBUTING.md) before opening a pull request.

Run the relevant checks before submitting:

```bash
npm test
npm run test:coverage
npm run typecheck
npm run docs:build
npm run test:browser
npm run test:tarball
npm run test:consumer
```

`test:browser` runs Chromium locally. Use `npm run test:browser:all` when all Playwright
browser engines are installed.

Keep English and Japanese documentation in sync. Changes to MDI grammar or its interpretation must link to the official [MDI syntax reference](https://mdi.illusions.app/syntax/reference/); this repository documents Milkdown integration and its tested support boundary.
