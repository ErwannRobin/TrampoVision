import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCALES, loadMessages, setLocale, type Locale } from '../../i18n';
import type { Status } from '../types';
import { ProcessingOverlay, announcement, type ProcessingOverlayProps } from './ProcessingOverlay';

// The languages are chunks of the build: they are all loaded before any test reads them.
await Promise.all(LOCALES.map(loadMessages));
afterEach(() => setLocale('en', false));

const BACKEND = 'MediaPipe Pose Landmarker · GPU';
const analyzing: Status = { kind: 'analyzing', done: 176, total: 420 };

const overlay = (status: Status, over: Partial<ProcessingOverlayProps> = {}) =>
  renderToStaticMarkup(
    createElement(ProcessingOverlay, {
      status,
      ready: false,
      fileName: 'set.mp4',
      backend: BACKEND,
      advanced: false,
      onAnalyze: () => {},
      onCancel: () => {},
      ...over,
    }),
  );

const inLocale = (locale: Locale, fn: () => string) => {
  setLocale(locale, false);
  return fn();
};

describe('the processing overlay in the live view', () => {
  it('says what is happening in plain words: a percent, what it does, that the video stays here, and a way out', () => {
    const html = overlay(analyzing);
    expect(html).toContain('42%');
    expect(html).toContain('Reading your set…');
    expect(html).toContain('Your video stays on this device.');
    expect(html).toContain('Cancel');
  });

  it('does not count frames and does not name the model or the backend, in any language', () => {
    for (const locale of LOCALES) {
      // What is read, not the markup (the ring's geometry has numbers of its own).
      const words = inLocale(locale, () => overlay(analyzing)).replace(/<[^>]+>/g, ' ');
      expect(words, locale).not.toContain('MediaPipe');
      expect(words, locale).not.toContain('176');
      expect(words, locale).not.toContain('420');
      expect(words, locale).toContain('42%');
    }
  });

  it('keeps the place of the time estimate, empty and hidden from a screen reader, until there is one', () => {
    expect(overlay(analyzing)).toContain('<p class="busy__text" aria-hidden="true"> </p>');
  });
});

describe('the processing overlay in the advanced tools', () => {
  it('keeps the frame count and the runtime', () => {
    const html = overlay(analyzing, { advanced: true });
    expect(html).toContain('Analyzing frame');
    expect(html).toContain('176');
    expect(html).toContain('420');
    expect(html).toContain(`Running on ${BACKEND}`);
    expect(html).not.toContain('Reading your set');
  });

  it('falls back to the reassurance while the runtime is not known yet', () => {
    const html = overlay(analyzing, { advanced: true, backend: '' });
    expect(html).toContain('Your video stays on this device.');
    expect(html).not.toContain('Running on');
  });
});

describe('the other states of the overlay', () => {
  it('opens and checks the video in plain words', () => {
    expect(overlay({ kind: 'loading', stage: 'reading' })).toContain('Opening your video…');
    expect(overlay({ kind: 'loading', stage: 'measuring' })).toContain('Checking your video…');
    expect(overlay({ kind: 'loading', stage: 'measuring' })).not.toContain('frame rate');
  });

  it('gives the reason for a conversion in one sentence, in every language', () => {
    const html = overlay({ kind: 'loading', stage: 'converting', progress: 0.4 });
    expect(html).toContain('Converting your video…');
    expect(html).toContain('Your browser cannot play this format directly, so the video is converted on your device.');
    expect(html).toContain('40%');
    const texts = LOCALES.map((l) =>
      inLocale(l, () => overlay({ kind: 'loading', stage: 'converting', progress: 0.4 })),
    );
    // The title and the reason, each in its own paragraph, and nothing technical (no codec, no size).
    for (const text of texts) {
      expect(text).toMatch(/class="busy__title">[^<]+<\/p><p class="busy__text">[^<]+<\/p>/);
      expect(text).not.toMatch(/H\.264|720|ffmpeg/);
    }
  });

  it('invites to analyze a loaded video and says it stays on the device', () => {
    const html = overlay({ kind: 'idle' }, { ready: true });
    expect(html).toContain('set.mp4');
    expect(html).toContain('Ready to analyze. Your video stays on this device.');
    expect(html).toContain('Analyze video');
  });

  it('shows nothing when there is nothing to show', () => {
    expect(overlay({ kind: 'idle' })).toBe('');
  });
});

describe('what a screen reader hears', () => {
  it('is one quiet live region: the container does not announce, the region is empty until it speaks', () => {
    for (const status of [analyzing, { kind: 'loading', stage: 'converting', progress: 0.4 } as Status]) {
      for (const advanced of [false, true]) {
        const html = overlay(status, { advanced });
        expect(html).toContain('<div class="busy">');
        expect(html.match(/role="status"/g)).toHaveLength(1);
        expect(html).toContain('<p class="sr-only" role="status"></p>');
      }
    }
  });

  it('names the stage once, then only the halfway and the near end, whatever the frame', () => {
    const at = (done: number): Status => ({ kind: 'analyzing', done, total: 420 });
    const start = announcement(at(0));
    expect(start).toBe('Reading your set…');
    // 420 frames, 1 by 1: the words change twice, not 420 times.
    const said = Array.from({ length: 421 }, (_, done) => announcement(at(done)));
    expect(said.filter((text, i) => i === 0 || text !== said[i - 1])).toEqual([
      'Reading your set…',
      'Halfway there',
      'Almost done',
    ]);
    expect(announcement(at(1))).toBe(start);
    expect(announcement(at(210))).toBe('Halfway there');
    expect(announcement(at(400))).toBe('Almost done');
  });

  it('gives the reason for a conversion when it starts, and moves on at the half', () => {
    const converting = (progress: number): Status => ({ kind: 'loading', stage: 'converting', progress });
    expect(announcement(converting(0))).toBe(
      'Converting your video… Your browser cannot play this format directly, so the video is converted on your device.',
    );
    expect(announcement(converting(0.3))).toBe(announcement(converting(0)));
    expect(announcement(converting(0.6))).toBe('Halfway there');
  });

  it('says the stage of a short step and nothing when idle or in error', () => {
    expect(announcement({ kind: 'loading', stage: 'reading' })).toBe('Opening your video…');
    expect(announcement({ kind: 'loading', stage: 'measuring' })).toBe('Checking your video…');
    expect(announcement({ kind: 'idle' })).toBe('');
    expect(announcement({ kind: 'error', message: 'x' })).toBe('');
  });

  it('never carries a frame count, a percent or a model name, in any language', () => {
    for (const locale of LOCALES) {
      setLocale(locale, false);
      for (const done of [0, 100, 210, 400]) {
        expect(announcement({ kind: 'analyzing', done, total: 420 }), `${locale} ${done}`).not.toMatch(/\d|MediaPipe/);
      }
    }
  });
});
