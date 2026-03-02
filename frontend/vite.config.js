import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

// Custom plugin to serve clear bot log file
function clearBotLogsPlugin() {
  return {
    name: 'clear-bot-logs',
    configureServer(server) {
      server.middlewares.use('/_logs/clear-bot', (req, res) => {
        const logPath = '/tmp/clear_bot.log';
        try {
          if (!fs.existsSync(logPath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ lines: [], total: 0 }));
            return;
          }
          const content = fs.readFileSync(logPath, 'utf-8');
          const allLines = content.split('\n').filter(l => l.trim());
          // Return last 200 lines
          const lines = allLines.slice(-200);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          });
          res.end(JSON.stringify({ lines, total: allLines.length }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), clearBotLogsPlugin()],
  envDir: '../',
  server: {
    host: '0.0.0.0',
    proxy: {
      '/rpc': {
        target: 'http://127.0.0.1:8545',
        changeOrigin: true,
        rewrite: () => '',  // Strip /rpc path — Anvil expects POST to /
      },
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '/graphql': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-charts': ['recharts'],
          'vendor-utils': ['ethers', 'lucide-react', 'axios', 'swr'],
        },
      },
    },
  },
})
