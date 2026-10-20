import { afterEach, describe, expect, it, vi } from 'vitest';

const ID = 'v-0123456789ab';
const clip = (id: string, title: string, score?: number) => ({
  id,
  title,
  size: 1,
  durationS: 27,
  analysis:
    score === undefined
      ? null
      : { score, found: 1, jumps: 8, backend: 'mediapipe', merged: false, contributions: 2, updatedAt: '' },
});

/** The module with a review service, and the answer `fetch` gives. */
async function withService(answer: (url: string, init?: RequestInit) => Response) {
  vi.stubEnv('VITE_REVIEW_API_URL', 'https://review.example');
  vi.stubEnv('VITE_REVIEW_INGEST_TOKEN', '');
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => answer(url, init));
  vi.resetModules();
  return import('./library');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the library of clips', () => {
  it('offers the clips nobody analyzed first, then the least read', async () => {
    const { inNeedOrder } = await withService(() => new Response());
    const clips = [clip('v-000000000001', 'A', 0.9), clip('v-000000000002', 'B'), clip('v-000000000003', 'C', 0.4)];
    expect(inNeedOrder(clips as never).map((c) => c.title)).toEqual(['B', 'C', 'A']);
  });

  it('reads the list, dropping what is not a clip', async () => {
    const { fetchLibrary } = await withService(() =>
      Response.json({ clips: [clip(ID, 'Alyssa Oh', 0.62), { id: '../x', title: 'bad' }, clip('v-0123456789ac', '')] }),
    );
    const clips = await fetchLibrary();
    expect(clips.map((c) => [c.id, c.analysis?.score])).toEqual([[ID, 0.62]]);
  });

  it('is empty when the service fails', async () => {
    const { fetchLibrary } = await withService(() => new Response('no', { status: 500 }));
    expect(await fetchLibrary()).toEqual([]);
  });

  it('sends the analysis gzipped with the app token, and reads what the library did with it', async () => {
    let seen: { url: string; type: string | null; auth: string | null } | null = null;
    const { sendLibraryAnalysis } = await withService((url, init) => {
      const headers = new Headers(init?.headers);
      seen = { url, type: headers.get('content-type'), auth: headers.get('authorization') };
      return Response.json({ kept: 'merged', score: 0.8, previousScore: 0.6, incomingScore: 0.5 }, { status: 201 });
    });
    const outcome = await sendLibraryAnalysis(ID, '{"a":1}');
    expect(seen).toEqual({
      url: `https://review.example/library/${ID}/analysis`,
      type: 'application/gzip',
      auth: 'Bearer',
    });
    expect(outcome).toEqual({ kept: 'merged', score: 0.8, previousScore: 0.6 });
  });

  it('says so when the stored analysis was kept', async () => {
    const { sendLibraryAnalysis } = await withService(() =>
      Response.json({ kept: 'stored', score: 0.9, incomingScore: 0.4 }),
    );
    expect(await sendLibraryAnalysis(ID, '{}')).toEqual({ kept: 'stored', score: 0.9, incomingScore: 0.4 });
  });

  it('refuses an analysis the library rejects, in words', async () => {
    const { sendLibraryAnalysis } = await withService(() => Response.json({ error: 'x' }, { status: 429 }));
    await expect(sendLibraryAnalysis(ID, '{}')).rejects.toThrow();
  });
});
