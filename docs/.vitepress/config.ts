import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "en-US",
  title: "Milkdown MDI",
  description: "MDI syntax support for Milkdown",
  base: "/milkdown-plugin-mdi/",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/" },
      { text: "GitHub", link: "https://github.com/Iktahana/milkdown-plugin-mdi" },
    ],
    sidebar: [
      { text: "Introduction", link: "/" },
      { text: "Getting Started", link: "/getting-started" },
      { text: "Syntax", link: "/syntax" },
      { text: "API", link: "/api" },
      { text: "Contributing", link: "/contributing" },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/Iktahana/milkdown-plugin-mdi" }],
    footer: { message: "Released under the MIT License.", copyright: "Copyright © 2026 Iktahana" },
  },
});
