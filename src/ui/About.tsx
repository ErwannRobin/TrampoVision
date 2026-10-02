import { useEffect, useRef } from 'react';
import { t, type StringKey } from '../i18n';
import { Button } from './kit';

/** Where each link goes. The club, the FIG and the research are the ones this project points to. */
const CLUB_URL = 'https://paristrampo12.com/';
const FIG_URL = 'https://www.gymnastics.sport/site/rules/';
const DOCS_URL = 'https://erwannrobin.github.io/TrampoVision/';
const CODE_URL = 'https://github.com/ErwannRobin/TrampoVision';
const RELATED: { url: string; label: StringKey }[] = [
  {
    url: 'https://www.jstage.jst.go.jp/article/sit/2025/0/2025_A-1-6/_article/-char/en',
    label: 'about.related.jstage',
  },
  { url: 'https://cir.nii.ac.jp/crid/1390870696565894656', label: 'about.related.nii' },
  { url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12473961/', label: 'about.related.pmc' },
  { url: 'https://devpost.com/software/bounceboard', label: 'about.related.devpost' },
];

const STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
const LIMITS = ['about.limit1', 'about.limit2', 'about.limit3', 'about.limit4', 'about.limit5'] as const;

/** A link to another site: opens in a new tab, and says so to a screen reader. */
function External({ href, children }: { href: string; children: string }) {
  return (
    <a className="about__link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only"> ({t('about.external')})</span>
    </a>
  );
}

/** What the app is, how it works, what it cannot do, and what it comes from and points to. Opened from the top bar or the first screen. */
export function About({ onClose }: { onClose: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  // Move to the top of the page for a keyboard or screen reader user.
  useEffect(() => title.current?.focus({ preventScroll: true }), []);
  return (
    <article className="about">
      <Button variant="ghost" size="sm" icon="chevron-left" onClick={onClose}>
        {t('about.back')}
      </Button>
      <h1 className="about__title t-brand" tabIndex={-1} ref={title}>
        {t('about.title')}
      </h1>
      <p className="about__lead">{t('about.lead')}</p>

      <section className="about__section" aria-labelledby="about-how">
        <h2 id="about-how">{t('about.howTitle')}</h2>
        <p>{t('about.howText')}</p>
        <ol className="about__steps">
          {STEPS.map((n) => (
            <li key={n}>
              <h3>{t(`about.step${n}.title`)}</h3>
              <p>{t(`about.step${n}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="about__section" aria-labelledby="about-device">
        <h2 id="about-device">{t('about.deviceTitle')}</h2>
        <p>{t('about.deviceText1')}</p>
        <p>{t('about.deviceText2')}</p>
      </section>

      <section className="about__section" aria-labelledby="about-limits">
        <h2 id="about-limits">{t('about.limitsTitle')}</h2>
        <ul>
          {LIMITS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </section>

      <section className="about__section" aria-labelledby="about-inspiration">
        <h2 id="about-inspiration">{t('about.inspirationTitle')}</h2>
        <p>{t('about.inspirationText')}</p>
        <p>
          <External href={CLUB_URL}>{t('about.inspirationLink')}</External>
        </p>
      </section>

      <section className="about__section" aria-labelledby="about-rules">
        <h2 id="about-rules">{t('about.rulesTitle')}</h2>
        <p>{t('about.rulesText')}</p>
        <p>
          <External href={FIG_URL}>{t('about.rulesLink')}</External>
        </p>
      </section>

      <section className="about__section" aria-labelledby="about-related">
        <h2 id="about-related">{t('about.relatedTitle')}</h2>
        <p>{t('about.relatedText')}</p>
        <ul>
          {RELATED.map((r) => (
            <li key={r.url}>
              <External href={r.url}>{t(r.label)}</External>
            </li>
          ))}
        </ul>
      </section>

      <section className="about__section" aria-labelledby="about-guides">
        <h2 id="about-guides">{t('about.guidesTitle')}</h2>
        <p>{t('about.guidesText')}</p>
        <ul>
          <li>
            <External href={DOCS_URL}>{t('about.guidesIntro')}</External>
          </li>
          <li>
            <External href={`${DOCS_URL}architecture.html`}>{t('about.guidesMap')}</External>
          </li>
        </ul>
      </section>

      <section className="about__section" aria-labelledby="about-code">
        <h2 id="about-code">{t('about.codeTitle')}</h2>
        <p>{t('about.codeText')}</p>
        <p>
          <External href={CODE_URL}>{t('about.codeLink')}</External>
        </p>
      </section>
    </article>
  );
}
