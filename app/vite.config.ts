import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load env from root project directory
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const clientPort = parseInt(env.CLIENT_PORT || '5175')
  const serverPort = parseInt(env.SERVER_PORT || '5176')

  return {
    plugins: [react()],
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
