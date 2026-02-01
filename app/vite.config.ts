import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load env from root project directory
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const clientPort = parseInt(env.CLIENT_PORT || '5175')
  const serverPort = parseInt(env.SERVER_PORT || '5176')

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
        devOptions: {
          enabled: true,
        },
        includeAssets: ['favicon.svg', 'favicon-active.svg', 'favicon-warning.svg'],
        manifest: {
          name: 'WorkIO',
          short_name: 'WorkIO',
          description: 'Terminal session manager for Claude Code',
          theme_color: '#09090b',
          background_color: '#09090b',
          display: 'standalone',
          icons: [
            {
              src: 'favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: clientPort,
      proxy: {
        '/api': `http://localhost:${serverPort}`,
        '/ws': {
          target: `ws://localhost:${serverPort}`,
          ws: true,
        },
      },
    },
  }
})
