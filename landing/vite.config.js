import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/rpc': {
        target: 'https://rld.fi',
        changeOrigin: true,
        secure: true,
      },
      '/graphql': {
        target: 'https://rld.fi',
        changeOrigin: true,
        secure: true,
      },
      '/api': {
        target: 'https://rld.fi',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
