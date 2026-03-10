import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  server:
    command === 'serve'
      ? {
          proxy: {
            '/api': {
              target: 'http://127.0.0.1:3000',
              changeOrigin: true,
            },
          },
        }
      : undefined,
  test: {
    environment: 'jsdom',
  },
}))
