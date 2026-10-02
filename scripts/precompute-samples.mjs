// Analyzes the sample videos once, so the app can open a sample with its analysis instead of running the pose model.
//
//   npm run precompute-samples                           video-sample/<name>.mp4 -> video-sample/<name>.pose.json (skips the ones already there)
//   npm run precompute-samples -- --force                analyze them all again
//   npm run precompute-samples -- --samples path/to/dir  another folder
//
// It drives the real app in headless Chrome (advanced mode, "Save analysis (JSON)" of the Export menu), so the file is
// exactly what a person would save, and the pose model, the video decoding and the settings are the app's own.
// Needs `npm i --no-save playwright-core` and Google Chrome (CHROME_PATH to point elsewhere than the macOS default).
// Then `make upload-assets` sends the .pose.json files next to the videos.
// The file holds the pose landmarks only: the skills, the scores and the tips are computed again in the app, so a
// change of the scoring needs no new run. Run it again when the pose model or its settings change.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './blob-store.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const samplesFlag = args.indexOf('--samples');
const samplesDir = samplesFlag >= 0 ? args[samplesFlag + 1] : join(root, 'video-sample');
const port = 5189;
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('[precompute] playwright-core is missing: run `npm i --no-save playwright-core`');
  process.exit(1);
}
if (!existsSync(samplesDir)) {
  console.error(`[precompute] no sample folder at ${samplesDir} (use --samples <folder>)`);
  process.exit(1);
}

// H.264 .mp4 only: the .MOV of a clip is the same footage.
const todo = readdirSync(samplesDir)
  .filter((n) => /\.mp4$/i.test(n))
  .map((n) => ({ video: join(samplesDir, n), out: join(samplesDir, `${n.replace(/\.mp4$/i, '')}.pose.json`) }))
  .filter(({ out }) => force || !existsSync(out));
if (!todo.length) {
  console.log('[precompute] nothing to do (every clip has its .pose.json; --force to redo)');
  process.exit(0);
}

// The app, without the review service: nothing the analysis does is sent anywhere.
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: root,
  env: { ...process.env, VITE_REVIEW_API_URL: '', VITE_REVIEW_INGEST_TOKEN: '' },
  stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; ; i++) {
  if (
    await fetch(`http://localhost:${port}`).then(
      (r) => r.ok,
      () => false,
    )
  )
    break;
  if (i > 60) {
    console.error('[precompute] the dev server did not start');
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
let failed = false;
for (const { video, out } of todo) {
  const name = video.slice(video.lastIndexOf('/') + 1);
  console.log(`[precompute] ${name}: analyzing...`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  try {
    await page.addInitScript(() => {
      localStorage.setItem('trampovision.language', 'en');
      localStorage.setItem('trampovision.advanced', 'on');
      localStorage.setItem('trampovision.reviewSync', 'off');
    });
    await page.goto(`http://localhost:${port}`);
    await page.locator('input[type=file]:not([capture])').first().setInputFiles(video);
    await page.getByRole('button', { name: 'Analyze video' }).click({ timeout: 60_000 });
    // The Export menu appears when there is a result.
    const exportMenu = page.getByRole('button', { name: 'Export' });
    await exportMenu.waitFor({ timeout: 15 * 60_000 });
    await exportMenu.click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Save analysis \(JSON\)/ }).click();
    await (await download).saveAs(out);
    console.log(`[precompute] ${name} -> ${out}`);
  } catch (err) {
    failed = true;
    console.error(`[precompute] ${name} failed: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
  } finally {
    await page.close();
  }
}
await browser.close();
stop();
process.exit(failed ? 1 : 0);
