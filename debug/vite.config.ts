import { defineConfig } from 'vite'

export default defineConfig({
  root: 'debug',
  optimizeDeps: {
    // wasm-pack resolves its binary relative to the original module. Vite's
    // dev pre-bundler would otherwise relocate that module without the WASM.
    exclude: ['@illusions-lab/mdi-core'],
  },
  server: { open: false },
})
