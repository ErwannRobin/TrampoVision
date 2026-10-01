import { describe, expect, it } from 'vitest';
import {
  fingerprint,
  originAllowed,
  parseIngest,
  parseReview,
  rowOf,
  tokenMatches,
  MAX_RECORDS_PER_POST,
} from './logic';

const record = (over: Record<string, unknown> = {}) => ({
  schema: 'trampovision.jump-record',
  version: 1,
  id: 'v1:2',
  videoId: 'v1',
  jumpId: 2,
  timestamps: { apexS: 1.2 },
  features: { a: 1 },
  analysis: { classifier: { id: 'temporal', version: '1' } },
  prediction: { skill: 'back', confidence: 0.7, certainty: 'probable', elementId: 'back-1s-0t-tuck' },
  twist: null,
  ...over,
});

describe('ingest', () => {
  it('reads what the queue needs from a record and keeps the record whole', () => {
    const r = rowOf(record());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      id: 'v1:2',
      video_id: 'v1',
      jump_id: 2,
      auto_skill: 'back',
      auto_element_id: 'back-1s-0t-tuck',
      auto_certainty: 'probable',
      auto_confidence: 0.7,
      classifier: 'temporal@1',
    });
    expect(JSON.parse(r.value.record)).toEqual(record());
  });

  it('accepts a jump the classifier left unclassified', () => {
    const r = rowOf(record({ prediction: { skill: 'unclassified', confidence: 0 } }));
    expect(r.ok && r.value.auto_element_id).toBe(null);
  });

  it.each([
    ['another schema', { schema: 'x' }],
    ['another version', { version: 2 }],
    ['an id that does not match', { id: 'v1:3' }],
    ['no prediction', { prediction: undefined }],
    ['no classifier', { analysis: {} }],
  ])('refuses %s', (_, over) => {
    expect(rowOf(record(over)).ok).toBe(false);
  });

  it('refuses a record that is too large, and a batch that is empty or too long', () => {
    expect(rowOf(record({ sequence: 'x'.repeat(500_000) })).ok).toBe(false);
    expect(parseIngest({ records: [] }).ok).toBe(false);
    expect(parseIngest({ records: Array(MAX_RECORDS_PER_POST + 1).fill(record()) }).ok).toBe(false);
    expect(parseIngest({ records: [record()] }).ok).toBe(true);
  });

  it('tells a changed result from a re-post of the same one', () => {
    expect(fingerprint(record())).toBe(fingerprint(record({ savedAt: 'later', figure: { elementId: 'x' } })));
    expect(fingerprint(record())).not.toBe(fingerprint(record({ prediction: { skill: 'front', confidence: 0.7 } })));
  });
});

describe('review', () => {
  it('confirm keeps the automatic figure, and needs one', () => {
    expect(parseReview({ verdict: 'confirm' }, 'back-1s-0t-tuck')).toMatchObject({
      ok: true,
      value: { status: 'confirmed', review_element_id: 'back-1s-0t-tuck' },
    });
    expect(parseReview({ verdict: 'confirm' }, null).ok).toBe(false);
  });

  it('correct needs a figure of the table', () => {
    expect(parseReview({ verdict: 'correct', elementId: 'back-1s-1t-straight' }, null)).toMatchObject({
      ok: true,
      value: { status: 'corrected', review_element_id: 'back-1s-1t-straight' },
    });
    expect(parseReview({ verdict: 'correct', elementId: 'made-up' }, null).ok).toBe(false);
    expect(parseReview({ verdict: 'correct' }, null).ok).toBe(false);
  });

  it('unknown and bad-data carry no figure, so they never become reference examples', () => {
    for (const verdict of ['unknown', 'bad-data']) {
      const r = parseReview({ verdict, elementId: 'back-1s-0t-tuck' }, 'back-1s-0t-tuck');
      expect(r.ok && r.value.review_element_id).toBe(null);
    }
  });

  it('trims the note and refuses another verdict', () => {
    const r = parseReview({ verdict: 'unknown', note: '  camera moved  ', reviewer: ' Sam ' }, null);
    expect(r.ok && [r.value.review_note, r.value.reviewer]).toEqual(['camera moved', 'Sam']);
    expect(parseReview({ verdict: 'maybe' }, null).ok).toBe(false);
  });
});

describe('tokens', () => {
  it('accepts only the exact bearer token', () => {
    expect(tokenMatches('Bearer abc', 'abc')).toBe(true);
    expect(tokenMatches('Bearer abd', 'abc')).toBe(false);
    expect(tokenMatches('Bearer abcd', 'abc')).toBe(false);
    expect(tokenMatches('abc', 'abc')).toBe(false);
    expect(tokenMatches(null, 'abc')).toBe(false);
    expect(tokenMatches('Bearer ', '')).toBe(false);
    expect(tokenMatches('Bearer abc', undefined)).toBe(false);
  });
});

describe('allowed origins', () => {
  const app = 'https://trampo-vision.vercel.app';
  const preview = 'https://trampo-vision-[a-z0-9-]+-erwann-robins-projects\\.vercel\\.app';

  it('allows the app and localhost', () => {
    expect(originAllowed(app, app)).toBe(true);
    expect(originAllowed('http://localhost:5174', app)).toBe(true);
    expect(originAllowed('https://evil.example', app)).toBe(false);
    expect(originAllowed(null, app, preview)).toBe(false);
  });

  it('allows the preview deployments of the app, and only those', () => {
    const ok = [
      'https://trampo-vision-git-claude-review-delete-erwann-robins-projects.vercel.app',
      'https://trampo-vision-gla9kwrd4n-erwann-robins-projects.vercel.app',
    ];
    for (const o of ok) expect(originAllowed(o, app, preview)).toBe(true);
    expect(originAllowed(ok[0], app)).toBe(false); // no pattern: no previews
    for (const o of [
      'https://trampo-vision-x-erwann-robins-projects.vercel.app.evil.example',
      'https://evil.example/https://trampo-vision-x-erwann-robins-projects.vercel.app',
      'http://trampo-vision-x-erwann-robins-projects.vercel.app',
      'https://other-x-erwann-robins-projects.vercel.app',
      'https://trampo-vision-x-someone-else.vercel.app',
    ])
      expect(originAllowed(o, app, preview)).toBe(false);
  });

  it('allows nothing extra when the pattern is not a valid expression', () => {
    expect(originAllowed('https://trampo-vision-x-erwann-robins-projects.vercel.app', app, '(')).toBe(false);
  });
});
