import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solidPlugin()],
  server: {
    port: 3000,
    proxy: {
      '/cdn': {
        target: 'https://dl.google.com/dl/edgedl/chromeos/recovery',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/cdn/, ''),
      },
    },
  },
  build: {
    target: 'esnext',
  },
  css: {
    modules: {
      generateScopedName: '[local]',
    },
  },
})
