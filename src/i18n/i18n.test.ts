import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { computeAnalysis } from '../analysis/computeAnalysis';
import { analysisWarnings } from '../ui/quality';
import { buildSession } from '../coaching/session';
import { summaryText } from '../coaching/summary';
import { analysisFingerprint, syncRecords } from '../dataset/record';
import { describeMovement } from '../dataset/movementLabel';
import { no3d } from '../pose3d/twist';
import { analyzeSkills } from '../skills/analyzeSkills';
import { FIG_ELEMENTS, elementName, movementName } from '../skills/fig/elements';
import { mannequinRoutine } from '../skills/testMannequin';
import { LiveRail } from '../ui/live/LiveRail';
import {
  LOCALES,
  formatDecimal,
  formatNumber,
  formatPercent,
  getLocale,
  interpolate,
  loadMessages,
  lower,
  matchLocale,
  pluralCategory,
  setLocale,
  t,
  tp,
  typography,
  upperFirst,
  type Locale,
} from './index';
import { messages } from './messages';
import { about } from './messages/en/about';
import { chrome } from './messages/en/chrome';
import { classifier } from './messages/en/classifier';
import { coach } from './messages/en/coach';
import { coaching } from './messages/en/coaching';
import { errors } from './messages/en/errors';
import { insights } from './messages/en/insights';
import { names } from './messages/en/names';
import { review } from './messages/en/review';
import { reviewer } from './messages/en/reviewer';
import { twist } from './messages/en/twist';
import { viewer } from './messages/en/viewer';

// The languages are chunks of the build: they are all loaded before any test reads them.
await Promise.all(LOCALES.map(loadMessages));

/** Runs `fn` with the interface in another language, and puts the language back. */
function inLocale<T>(locale: Locale, fn: () => T): T {
  const before = getLocale();
  setLocale(locale, false);
  try {
    return fn();
  } finally {
    setLocale(before, false);
  }
}

afterEach(() => setLocale('en', false));

const holes = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const forms = (m: string | { one: string; other: string }) => (typeof m === 'string' ? [m] : [m.one, m.other]);
const english = Object.entries(messages.en) as [string, string | { one: string; other: string }][];
const others = LOCALES.filter((l) => l !== 'en');

describe('the messages', () => {
  it('have a key in one domain only', () => {
    const domains = [
      about,
      chrome,
      classifier,
      coach,
      coaching,
      errors,
      insights,
      names,
      review,
      reviewer,
      twist,
      viewer,
    ];
    const seen = new Map<string, number>();
    domains.forEach((d, i) =>
      Object.keys(d).forEach((k) => {
        expect(seen.has(k), `${k} is in two domains`).toBe(false);
        seen.set(k, i);
      }),
    );
    expect(seen.size).toBe(english.length);
  });

  it.each(others)('of %s hold every key of English, in the same shape and with the same holes', (locale) => {
    const other = messages[locale] as unknown as Record<string, string | { one: string; other: string }>;
    for (const [key, en] of english) {
      const tr = other[key];
      expect(tr, `${locale}: ${key} is missing`).toBeDefined();
      expect(typeof tr, `${locale}: ${key}`).toBe(typeof en);
      // Every form of a count says the same things as the English ones (a form may leave a hole out only where English does).
      const wanted = holes(forms(en).join(' '));
      for (const form of forms(tr)) {
        const got = holes(form);
        expect(
          got.every((h) => wanted.includes(h)),
          `${locale}: ${key} has an unknown hole in "${form}"`,
        ).toBe(true);
      }
      expect(holes(forms(tr).join(' ')), `${locale}: ${key} lost a hole`).toEqual(wanted);
    }
    expect(Object.keys(other).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it.each(others)('of %s are translated: only what has no word of English stays as it is', (locale) => {
    const other = messages[locale] as unknown as Record<string, string | { one: string; other: string }>;
    const same: string[] = [];
    for (const [key, en] of english) {
      const a = JSON.stringify(en);
      const b = JSON.stringify(other[key]);
      if (a !== b) continue;
      const words = forms(en)
        .join(' ')
        .replace(/\{\w+\}/g, '')
        .match(/[A-Za-z]{4,}/g);
      if (words) same.push(`${key}: ${forms(en)[0]}`);
    }
    // A word that is the same in the other language is fine (a name, a cognate): they are listed so that a new one is looked at.
    const allowed = [...ALLOWED_SAME, ...(SAME_IN[locale] ?? [])];
    expect(same.filter((s) => !allowed.some((a) => s.startsWith(`${a}:`) || s.includes(a)))).toEqual([]);
  });

  it('never leave a hole or an undefined behind once filled', () => {
    for (const locale of LOCALES) {
      for (const [key, m] of Object.entries(messages[locale]!)) {
        for (const form of forms(m as string | { one: string; other: string })) {
          const filled = interpolate(form, Object.fromEntries(holes(form).map((h) => [h, 'x'])));
          expect(filled, `${locale}: ${key}`).not.toMatch(/[{}]|undefined|NaN/);
        }
      }
    }
  });
});

/** Messages that read the same in French or in German because the word is the same there (a cognate). */
const SAME_IN: Partial<Record<Locale, string[]>> = {
  fr: [
    'about.inspirationTitle',
    'setup.trampoline',
    'ev.rotation.label',
    'part.structure',
    'certainty.probable',
    'stage.direction.title',
    'check.direction',
    'check.position',
    'unit.points',
    'picker.direction',
    'picker.position',
    'fig.rotation',
    'coach.alternatives',
    'criterion.rotation',
    'criterion.direction',
    'criterion.position',
    'row.rotation',
    'group.rotation',
    'twist.row.direction',
    'tl.zoomClip',
    'tech.rotation',
    'tech.validation',
    'chart.orientationSeries',
    'matrix.total',
    'fail.signal',
    'rc.rotation',
    'rc.source.auto',
    'rv.pause',
    'rv.noteAria',
    'rv.verdictGroup',
    'rv.somDouble',
    'rv.somTriple',
  ],
  de: [
    'about.inspirationTitle',
    'setup.appearanceSystem',
    'stage.region',
    'stage.viewVideo',
    'export.video',
    'skill.fig-element',
    'ev.rotation.label',
    'fig.rotation',
    'row.rotation',
    'group.rotation',
    'tl.zoomClip',
    'tech.rotation',
    'fail.status',
    'fail.signal',
    'rc.rotation',
    'rv.pause',
  ],
};

/** Messages whose text is a name or a technical word, and so reads the same in every language. */
const ALLOWED_SAME = [
  'WebGPU',
  'WebGL',
  'WebAssembly',
  'MediaPipe',
  'ViTPose',
  'IndexedDB',
  'TrampoVision',
  'Debug',
  'Lite',
  'Full',
  'Heavy',
  'ffmpeg',
  'H.264',
];

describe('the language', () => {
  it('is chosen from the preferred languages of the browser', () => {
    expect(matchLocale(['fr-CA', 'en'])).toBe('fr');
    expect(matchLocale(['pt-BR', 'de-AT', 'en'])).toBe('de');
    expect(matchLocale(['ja-JP'])).toBe('ja');
    expect(matchLocale(['EN_us'])).toBe('en');
    expect(matchLocale(['it', 'es'])).toBeNull();
    expect(matchLocale([])).toBeNull();
  });

  it('starts as English where there is no browser (tests, scripts)', () => {
    expect(getLocale()).toBe('en');
  });

  it('fills the holes of a message, leaves an unknown one visible, and falls back to English and to the key', () => {
    expect(t('busy.analyzing', { done: 3, total: 10 })).toBe('Analyzing frame 3 of 10');
    expect(inLocale('fr', () => t('busy.analyzing', { done: 3, total: 10 }))).toBe('Analyse de l’image 3 sur 10');
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(t('no.such.key' as never)).toBe('no.such.key');
  });

  it('counts as the language does', () => {
    expect([0, 1, 2].map((n) => pluralCategory(n, 'en'))).toEqual(['other', 'one', 'other']);
    expect([0, 1, 1.5, 2].map((n) => pluralCategory(n, 'fr'))).toEqual(['one', 'one', 'one', 'other']);
    expect([1, 1.5, 2].map((n) => pluralCategory(n, 'de'))).toEqual(['one', 'other', 'other']);
    expect([0, 1, 2].map((n) => pluralCategory(n, 'ja'))).toEqual(['other', 'other', 'other']);
    expect(tp('count.jumps', 1)).toBe('1 jump');
    expect(tp('count.jumps', 3)).toBe('3 jumps');
    expect(inLocale('fr', () => tp('count.jumps', 0))).toBe('0 saut');
    expect(inLocale('de', () => tp('count.jumps', 2))).toBe('2 Sprünge');
    expect(inLocale('ja', () => tp('count.jumps', 2))).toBe('2ジャンプ');
  });

  it('writes numbers as the language does', () => {
    expect(formatNumber(0.6, 1, 'en')).toBe('0.6');
    expect(formatNumber(0.6, 1, 'fr')).toBe('0,6');
    expect(formatNumber(0.6, 1, 'de')).toBe('0,6');
    expect(formatNumber(0.6, 1, 'ja')).toBe('0.6');
    expect(formatDecimal(1.5, 2, 'de')).toBe('1,5');
    expect(formatDecimal(2, 2, 'fr')).toBe('2');
    expect(formatPercent(0.5, 0, 'en')).toBe('50%');
    expect(formatPercent(0.5, 0, 'fr').replace(/\s/g, ' ')).toBe('50 %');
    expect(formatPercent(0.5, 0, 'de').replace(/\s/g, ' ')).toBe('50 %');
  });

  it('keeps no sign on a number that is, or rounds to, zero, and keeps it on any other negative', () => {
    for (const locale of LOCALES) {
      expect(formatDecimal(-0, 2, locale), locale).toBe(formatDecimal(0, 2, locale));
      expect(formatDecimal(-0.004, 2, locale), locale).toBe(formatDecimal(0, 2, locale));
      expect(formatNumber(-0.04, 1, locale), locale).toBe(formatNumber(0, 1, locale));
      expect(formatPercent(-0.001, 0, locale), locale).toBe(formatPercent(0, 0, locale));
      expect(formatNumber(-0.5, 1, locale), locale).not.toBe(formatNumber(0.5, 1, locale));
      expect(formatNumber(-0.05, 2, locale), locale).not.toBe(formatNumber(0.05, 2, locale));
      expect(formatDecimal(-10, 2, locale), locale).not.toBe(formatDecimal(10, 2, locale));
    }
  });

  it('puts a no-break space where French wants one, and leaves the other languages alone', () => {
    expect(typography('Terminé : oui ? « ok »', 'fr')).toBe('Terminé : oui ? « ok »');
    expect(typography('Done : yes ?', 'en')).toBe('Done : yes ?');
    expect(inLocale('fr', () => t('topbar.home'))).toBe('TrampoVision : retour à l’accueil');
  });

  it('changes case only where the language has case', () => {
    expect(upperFirst('back somersault', 'en')).toBe('Back somersault');
    expect(upperFirst('saut droit', 'fr')).toBe('Saut droit');
    expect(upperFirst('宙返り', 'ja')).toBe('宙返り');
    expect(lower('Gehockt', 'de')).toBe('gehockt');
  });
});

describe('the names of the elements', () => {
  it('are built in every language, with no hole, and are different for different elements', () => {
    for (const locale of LOCALES) {
      const names = FIG_ELEMENTS.map((e) => movementName(e, locale));
      for (const n of names) expect(n).toMatch(/\S/);
      for (const n of names) expect(n).not.toMatch(/[{}]|undefined/);
      expect(new Set(names).size, locale).toBe(FIG_ELEMENTS.length);
    }
  });

  it('read like the sport says them', () => {
    const e = FIG_ELEMENTS.find((x) => x.id === 'back-1s-1t-straight')!;
    expect(movementName(e, 'en')).toBe('Back somersault, full twist (straight)');
    expect(movementName(e, 'fr')).toBe('Salto arrière, 1 vrille (tendu)');
    expect(movementName(e, 'de')).toBe('Salto rückwärts mit ganzer Schraube (gestreckt)');
    expect(movementName(e, 'ja')).toBe('後方宙返り 1回ひねり（伸身）');
    const jump = FIG_ELEMENTS.find((x) => x.id === 'none-0s-0t-tuck')!;
    expect([
      movementName(jump, 'en'),
      movementName(jump, 'fr'),
      movementName(jump, 'de'),
      movementName(jump, 'ja'),
    ]).toEqual(['Tuck jump', 'Saut groupé', 'Hocksprung', '抱え込みジャンプ']);
    const triple = FIG_ELEMENTS.find((x) => x.id === 'back-3s-0.5t-pike')!;
    expect(movementName(triple, 'fr')).toBe('Triple salto arrière, ½ vrille (carpé)');
    expect(movementName(triple, 'de')).toBe('Dreifachsalto rückwärts mit halber Schraube (gebückt)');
  });

  it('keep an English name in the data and show the one of the language', () => {
    const e = FIG_ELEMENTS.find((x) => x.id === 'front-2s-0t-pike')!;
    expect(e.name).toBe('Front double somersault (pike)');
    expect(inLocale('fr', () => e.name)).toBe('Front double somersault (pike)');
    expect(inLocale('fr', () => elementName(e))).toBe('Double salto avant (carpé)');
    expect(elementName(e)).toBe('Front double somersault (pike)');
  });

  it('describe a label of the picker in the language', () => {
    const label = { position: 'tuck', direction: 'back', somersaults: 2, halfTwists: 2 } as const;
    expect(describeMovement(label)).toBe('Back double somersault, full twist, tuck');
    expect(inLocale('fr', () => describeMovement(label))).toBe('Double salto arrière, 1 vrille, groupé');
    expect(inLocale('ja', () => describeMovement(label))).toBe('後方2回宙返り、1回ひねり、抱え込み');
  });
});

/** A short set: a bounce, a back tuck, a front pike, a straight jump with a quarter turn that can only be a guess. */
const { track } = mannequinRoutine({
  jumps: [
    { v0: 4.4, shape: 'straight' },
    { v0: 4.8, turns: -1, shape: 'tuck' },
    { v0: 4.8, turns: 1, shape: 'pike' },
    { v0: 4.6, turns: 1.25, shape: 'straight' },
  ],
  facing: 1,
});
const result = computeAnalysis(track, { athleteHeightM: 1.75 });

describe.each(LOCALES)('an analysis in %s', (locale) => {
  const skills = inLocale(locale, () => analyzeSkills(result));
  const session = inLocale(locale, () => buildSession({ skills, result, twist: null }));

  it('says everything in the language, with nothing left unfilled', () => {
    inLocale(locale, () => {
      const texts: string[] = [];
      for (const j of skills.jumps) {
        const p = j.prediction;
        texts.push(p.label, p.summary, ...p.evidence.flatMap((e) => [e.label, e.text, e.note ?? '']));
        texts.push(...p.limitations.flatMap((l) => [l.signal, l.problem, l.needed]));
        texts.push(...p.confidenceParts.map((c) => c.name));
        texts.push(
          ...(p.stages ?? []).flatMap((s) => [s.title, s.observed, ...s.notes, ...s.distribution.map((d) => d.label)]),
        );
        texts.push(
          ...(p.candidates ?? []).flatMap((c) => [
            c.name,
            ...c.checks.flatMap((k) => [k.criterion, k.expected, k.observed]),
          ]),
        );
        if (p.failure) texts.push(p.failure.message, ...p.failure.distances.map((d) => d.text));
      }
      for (const j of session.jumps) {
        texts.push(...j.tips.flatMap((x) => [x.title, x.text, x.detail]), j.why ?? '');
        texts.push(...(j.difficulty?.parts.map((x) => x.label) ?? []));
        texts.push(
          ...(j.execution?.items.flatMap((x) => [x.label, x.detail]) ?? []),
          ...(j.execution?.unchecked.flatMap((x) => [x.label, x.why]) ?? []),
        );
      }
      texts.push(...session.summary.warnings, ...session.summary.focus.flatMap((f) => [f.title, f.text, f.summary]));
      texts.push(...analysisWarnings(result), no3d().problem, summaryText(session, 'clip'));
      for (const text of texts) {
        expect(text).not.toMatch(/[{}]|undefined|NaN/);
      }
      expect(texts.filter((x) => x).length).toBeGreaterThan(50);
    });
  });

  it('names the jumps in the language of the moment', () => {
    inLocale(locale, () => {
      const expected = movementName(
        FIG_ELEMENTS.find((e) => e.id === 'back-1s-0t-tuck')!,
        locale,
      );
      expect(session.jumps[1].element ? elementName(session.jumps[1].element) : '').toBe(expected);
      expect(skills.jumps[1].prediction.label).toBe(expected);
    });
  });

  it('renders the live rail without an English word where another language is asked for', () => {
    const html = inLocale(locale, () =>
      renderToStaticMarkup(
        createElement(LiveRail, {
          session,
          selected: 1,
          onSelect: () => {},
          onPlayJump: () => {},
          onConfirm: () => {},
          onPick: () => {},
          onOther: () => {},
          onClear: () => {},
          onDeduction: () => {},
          canLabel: true,
          onOpenSetup: () => {},
          onShowAdvanced: () => {},
          notes: [],
          title: 'clip',
        }),
      ),
    );
    expect(html).not.toMatch(/[{}]|undefined|NaN/);
    if (locale !== 'en') {
      for (const word of [
        'Difficulty',
        'Execution',
        'Copy summary',
        'Work on next',
        'What to fix',
        'Yes, that is it',
      ]) {
        expect(html).not.toContain(word);
      }
    } else expect(html).toContain('Copy summary');
  });
});

describe('a record of a jump', () => {
  it('is the same result whatever the language it was made in', () => {
    const records = (locale: Locale) =>
      inLocale(locale, () =>
        syncRecords([], {
          videoId: 'v-test',
          fileName: 'clip.mp4',
          result,
          skills: analyzeSkills(result),
          twist: null,
          now: new Date('2026-01-01T00:00:00Z'),
        }),
      );
    const english = records('en');
    for (const locale of others) {
      const other = records(locale);
      // The words differ...
      expect(other.map((r) => r.prediction.summary)).not.toEqual(english.map((r) => r.prediction.summary));
      // ...and the fingerprint, which decides what is stale and what was sent, does not.
      expect(other.map(analysisFingerprint)).toEqual(english.map(analysisFingerprint));
    }
  });
});
