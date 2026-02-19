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
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler', {}]],
        },
      }),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
        devOptions: {
          enabled: true,
        },
        includeAssets: [
          'favicon.svg',
          'favicon-active.svg',
          'favicon-warning.svg',
          'icon2.png',
        ],
        manifest: {
          name: 'WorkIO',
          short_name: 'WorkIO',
          description: 'Terminal session manager for Claude Code',
          theme_color: '#171717',
          background_color: '#171717',
          display: 'standalone',
          icons: [
            {
              src: 'icon2.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
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
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            xterm: [
              '@xterm/xterm',
              '@xterm/addon-fit',
              '@xterm/addon-search',
              '@xterm/addon-web-links',
              '@xterm/addon-webgl',
            ],
            markdown: [
              'react-markdown',
              'react-syntax-highlighter',
              'rehype-katex',
              'remark-gfm',
              'remark-math',
              'katex',
            ],
            dndkit: [
              '@dnd-kit/core',
              '@dnd-kit/sortable',
              '@dnd-kit/modifiers',
              '@dnd-kit/utilities',
            ],
            vendor: [
              'react',
              'react-dom',
              'react-resizable-panels',
              'socket.io-client',
              'swr',
            ],
          },
        },
      },
    },
    server: {
      port: clientPort,
      host: true,
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
