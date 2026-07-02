import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// In production, /proxy/* is served by the Express server on the VPS.
// In dev, Vite proxies /proxy/* to the real APIs and injects keys server-side
// so nothing sensitive ends up in the browser bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: true,
      proxy: {
        '/proxy/anthropic': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/proxy\/anthropic/, '/v1/messages'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // Strip browser Origin/Referer. Anthropic refuses calls with an
              // Origin header unless you pass `anthropic-dangerous-direct-
              // browser-access: true`, which isn't what we are — we're
              // acting as a server-side proxy on behalf of the browser.
              proxyReq.removeHeader('origin');
              proxyReq.removeHeader('referer');
              if (env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY) {
                proxyReq.setHeader('x-api-key', env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY);
                proxyReq.setHeader('anthropic-version', '2023-06-01');
              }
            });
          },
        },
        '/proxy/openai': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/proxy\/openai/, '/v1/chat/completions'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY) {
                proxyReq.setHeader('authorization', `Bearer ${env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY}`);
              }
            });
          },
        },
        '/proxy/deepgram': {
          target: 'https://api.deepgram.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/proxy\/deepgram/, '/v1/listen'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (env.DEEPGRAM_API_KEY || env.VITE_DEEPGRAM_API_KEY) {
                proxyReq.setHeader('authorization', `Token ${env.DEEPGRAM_API_KEY || env.VITE_DEEPGRAM_API_KEY}`);
              }
            });
          },
        },
        '/oura': {
          target: 'https://api.ouraring.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/oura/, '/v2'),
        },
      },
    },
  };
});
