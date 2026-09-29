import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Production build: the browser itself enforces "no network except this origin" through a CSP.
 * The only other origin is the review service, when the build has one (VITE_REVIEW_API_URL).
 * (Not applied in `vite dev`, which needs inline scripts and a websocket for hot reload; the
 * runtime guard in src/localOnlyGuard.ts covers that case.)
 */
const csp = (reviewOrigin: string) =>
  [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' blob: data:${reviewOrigin ? ` ${reviewOrigin}` : ''}`,
    "media-src 'self' blob:",
    "img-src 'self' blob: data:",
    "worker-src 'self' blob:",
  ].join('; ');

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'local-only-csp',
      apply: 'build',
      transformIndexHtml: () => {
        let origin = '';
        try {
          const api = loadEnv(mode, '.', '').VITE_REVIEW_API_URL;
          origin = api ? new URL(api).origin : '';
        } catch {
          // A malformed URL is refused by the app too: the CSP stays local-only.
        }
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: csp(origin) },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
    {
      // Link previews need absolute URLs. SITE_URL wins, then Vercel's production host, then the known deployment.
      name: 'open-graph-urls',
      apply: 'build',
      transformIndexHtml: () => {
        const env = loadEnv(mode, '.', '');
        const vercel = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
        const site = env.SITE_URL || vercel || 'https://trampo-vision.vercel.app';
        const base = site.endsWith('/') ? site : `${site}/`;
        const image = `${base}og-image.png`;
        return [
          { tag: 'meta', attrs: { property: 'og:url', content: base }, injectTo: 'head' as const },
          { tag: 'meta', attrs: { property: 'og:image', content: image }, injectTo: 'head' as const },
          { tag: 'meta', attrs: { name: 'twitter:image', content: image }, injectTo: 'head' as const },
        ];
      },
    },
  ],
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'worker/src/**/*.test.ts'] },
}));
