import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';

const backendProxy: ProxyOptions = {
  target: 'http://localhost:8080',
  configure(proxy) {
    proxy.on('error', (_error, _request, response) => {
      if ('writeHead' in response && !response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            error: { code: 'PROXY_NETWORK_ERROR', message: 'Сервер недоступен', retryable: true },
          }),
        );
      }
    });
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backendProxy,
      '/health': backendProxy,
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], clearMocks: true },
});
