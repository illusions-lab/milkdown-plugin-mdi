import { defineConfig } from 'vitepress'

const github = 'https://github.com/illusions-lab/milkdown-plugin-mdi'

export default defineConfig({
  title: 'Milkdown MDI', description: 'MDI integration for Milkdown', base: '/milkdown-plugin-mdi/', cleanUrls: true,
  locales: {
    root: { label: 'English', lang: 'en-US', themeConfig: {
      nav: [{ text: 'Guide', link: '/' }, { text: 'GitHub', link: github }],
      sidebar: [
        { text: 'Introduction', link: '/' }, { text: 'Getting Started', link: '/getting-started' },
        { text: 'Integration', link: '/integration' }, { text: 'Syntax Support', link: '/syntax' },
        { text: 'API', link: '/api' }, { text: 'Contributing', link: '/contributing' },
      ],
    } },
    ja: { label: '日本語', lang: 'ja-JP', link: '/ja/', themeConfig: {
      nav: [{ text: 'ガイド', link: '/ja/' }, { text: 'GitHub', link: github }],
      sidebar: [
        { text: 'はじめに', link: '/ja/' }, { text: '導入', link: '/ja/getting-started' },
        { text: '統合', link: '/ja/integration' }, { text: '構文サポート', link: '/ja/syntax' },
        { text: 'API', link: '/ja/api' }, { text: 'コントリビュート', link: '/ja/contributing' },
      ],
    } },
  },
  themeConfig: {
    socialLinks: [{ icon: 'github', link: github }],
    footer: { message: 'Released under the MIT License.', copyright: 'Copyright © 2026 Iktahana' },
  },
})
