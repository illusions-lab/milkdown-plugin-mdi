import { defineConfig } from 'vite'

export default defineConfig({
  root: 'debug',
  build: { rollupOptions: { input: { main: 'debug/index.html', layout: 'debug/layout-contract.html', testing: 'debug/testing.html' } } },
  optimizeDeps: {
    // wasm-pack resolves its binary relative to the original module. Vite's
    // dev pre-bundler would otherwise relocate that module without the WASM.
    exclude: ['@illusions-lab/mdi-core'],
  },
  server: { open: false },
})
