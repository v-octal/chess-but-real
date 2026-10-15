import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PASEO_PORT || process.env.PORT || 5173),
    strictPort: true,
    allowedHosts: process.env.ARENA_PREVIEW_URL ? [new URL(process.env.ARENA_PREVIEW_URL).hostname] : [],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}))
