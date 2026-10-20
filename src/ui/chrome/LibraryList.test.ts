import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LibraryClip } from '../../sync/library';
import { LibraryList } from './LibraryList';

const clip = (n: number, score: number | null): LibraryClip => ({
  id: `v-00000000000${n}`,
  title: `Clip ${n}`,
  size: 1,
  durationS: 27,
  analysis:
    score === null
      ? null
      : { score, found: 1, jumps: 8, backend: 'mediapipe', merged: false, contributions: 1, updatedAt: '' },
});

const render = (clips: LibraryClip[], busy = false) =>
  renderToStaticMarkup(createElement(LibraryList, { clips, onOpen: () => {}, busy }));

describe('the library on the first screen', () => {
  it('is absent when there is no library', () => {
    expect(render([])).toBe('');
  });

  it('lists the clips to analyze first, with how much of each is read', () => {
    const html = render([clip(1, 0.91), clip(2, null), clip(3, 0.42)]);
    expect(html.indexOf('Clip 2')).toBeLessThan(html.indexOf('Clip 3'));
    expect(html.indexOf('Clip 3')).toBeLessThan(html.indexOf('Clip 1'));
    expect(html).toContain('91%');
    expect(html).toContain('42%');
    expect(html).toContain('To analyze');
    expect(html).toContain('3 clips, 1 to analyze');
  });

  it('does not open a clip while another is being read', () => {
    expect(render([clip(1, null)], true)).toContain('disabled');
  });
});
