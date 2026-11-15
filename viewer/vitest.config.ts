import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte({ compilerOptions: { runes: true } })],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    // format.ts renders browser-local time; pin UTC so expectations are stable
    env: { TZ: 'UTC' },
  },
})
