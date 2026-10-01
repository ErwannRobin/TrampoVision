/// <reference types="node" />
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Production build: the browser itself enforces "no network except this origin" through a CSP.
 * The only other origins are the review service (VITE_REVIEW_API_URL), the asset host
 * (VITE_ASSET_BASE_URL: models, wasm and sample, read only) and Jev (VITE_JEV_API_URL: measurements of one jump,
 * sent by hand from the Classification tab), when the build has them.
 * (Not applied in `vite dev`, which needs inline scripts and a websocket for hot reload; the
 * runtime guard in src/localOnlyGuard.ts covers that case.)
 */
const csp = (extraOrigins: string[]) =>
  [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${["'self'", 'blob:', 'data:', ...extraOrigins].join(' ')}`,
    "media-src 'self' blob:",
    "img-src 'self' blob: data:",
    "worker-src 'self' blob:",
  ].join('; ');

const installedVersion = (pkg: string): string =>
  JSON.parse(readFileSync(join('node_modules', pkg, 'package.json'), 'utf8')).version;

export default defineConfig(({ mode }) => ({
  define: {
    __MEDIAPIPE_VERSION__: JSON.stringify(installedVersion('@mediapipe/tasks-vision')),
    __FFMPEG_CORE_VERSION__: JSON.stringify(installedVersion('@ffmpeg/core')),
  },
  plugins: [
    react(),
    {
      name: 'local-only-csp',
      apply: 'build',
      transformIndexHtml: () => {
        const env = loadEnv(mode, '.', '');
        const origins: string[] = [];
        for (const value of [env.VITE_REVIEW_API_URL, env.VITE_ASSET_BASE_URL, env.VITE_JEV_API_URL]) {
          try {
            if (value) origins.push(new URL(value).origin);
          } catch {
            // A malformed URL is refused by the app too: the CSP stays local-only.
          }
        }
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: csp(origins) },
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
    {
      // With VITE_ASSET_BASE_URL the big files are read from that host, so they must not also sit in the deployment
      // (Vite copies all of public/, and bundles the ffmpeg wasm it imports).
      name: 'strip-hosted-assets',
      apply: 'build',
      closeBundle() {
        if (!loadEnv(mode, '.', '').VITE_ASSET_BASE_URL) return;
        rmSync('dist/models', { recursive: true, force: true });
        for (const dir of ['dist/mediapipe/wasm', 'dist/assets']) {
          try {
            for (const file of readdirSync(dir)) {
              if (file.endsWith('.wasm')) rmSync(join(dir, file));
            }
          } catch {
            // The folder does not exist in this build.
          }
        }
      },
    },
  ],
  // The app and the reviewer page (/review.html) share the build, the CSP and the review service settings.
  build: { rollupOptions: { input: { main: 'index.html', review: 'review.html' } } },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'worker/src/**/*.test.ts'] },
}));
