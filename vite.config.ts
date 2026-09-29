import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Production build: the browser itself enforces "no network except this origin" through a CSP.
 * (Not applied in `vite dev`, which needs inline scripts and a websocket for hot reload; the
 * runtime guard in src/localOnlyGuard.ts covers that case.)
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' blob: data:",
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
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
      ],
    },
    {
      // Link previews need absolute URLs. Set SITE_URL (e.g. https://example.org/trampovision/) when building.
      name: 'open-graph-urls',
      apply: 'build',
      transformIndexHtml: () => {
        const site = loadEnv(mode, '.', '').SITE_URL;
        if (!site) return [];
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
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
