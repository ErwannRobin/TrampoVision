/**
 * The big files (pose models, wasm runtimes, sample videos) would be copied into every deployment, and a host
 * charges for each copy. The build can leave them out: with VITE_ASSET_BASE_URL set they are read from that public
 * folder at runtime (see scripts/upload-assets.mjs for the layout). Without it, they are served from this origin
 * (public/ after `npm run fetch-assets`), so `npm run dev` needs no setup.
 */
const raw = (import.meta.env.VITE_ASSET_BASE_URL as string | undefined)?.trim();

/** The external asset folder, with a trailing slash, or null when everything is served from this origin. */
export const assetBase: string | null = raw ? `${raw.replace(/\/+$/, '')}/` : null;

/** Versions of the packages whose wasm is hosted: a new version gets a new folder, never a stale file. */
export const MEDIAPIPE_VERSION = __MEDIAPIPE_VERSION__;
export const FFMPEG_CORE_VERSION = __FFMPEG_CORE_VERSION__;
