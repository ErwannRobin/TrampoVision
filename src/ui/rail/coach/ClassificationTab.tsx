import { useState } from 'react';
import { t } from '../../../i18n';
import type { SkillAnalysis } from '../../../skills/analyzeSkills';
import { elementById, elementName } from '../../../skills/fig/elements';
import { classifyWithJev, type JevResult } from '../../../skills/jev/classify';
import type { JevClientOptions } from '../../../skills/jev/client';
import type { JumpSkillResult } from '../../../skills/types';
import { pct } from '../../format';
import { useLocalStorage } from '../../hooks';
import { Badge, Banner, Button, Field } from '../../kit';
import { compareLines } from './jevCompare';
import { Group } from './parts';
import { skillName } from '../../insights';

interface Props {
  skills: SkillAnalysis;
  selected: number;
}

/** Where the browser may call Jev: the build says so (VITE_JEV_API_URL), or the tab only explains. */
const JEV_URL = (import.meta.env.VITE_JEV_API_URL as string | undefined) || null;
const KEY_STORAGE = 'trampovision.jevKey';

type Run = { state: 'running' } | { state: 'done'; result: JevResult };

/** Answers kept for as long as the analysis they come from: a new analysis builds new jump objects, so old answers are never shown on it. */
const runs = new WeakMap<JumpSkillResult, Run>();

const nameOf = (id: string | null) => {
  const e = id ? elementById(id) : undefined;
  return e ? elementName(e) : t('coach.jev.none');
};

/**
 * The classification by Jev (TypeSafe) next to the local one. Jev is only asked when the button is pressed: nothing is sent while
 * the person looks at a jump, and what is sent is the measurements of that jump, never a frame.
 */
export function ClassificationTab({ skills, selected }: Props) {
  const [apiKey, setApiKey] = useLocalStorage<string>(KEY_STORAGE, '');
  const [, redraw] = useState(0);
  const j = skills.jumps[Math.min(selected, skills.jumps.length - 1)];
  const key = apiKey.trim();
  const client: JevClientOptions | null = JEV_URL && key ? { apiKey: key, baseUrl: JEV_URL } : null;

  const ask = async (jumps: JumpSkillResult[]) => {
    if (!client) return;
    for (const jump of jumps) if (jump.input) runs.set(jump, { state: 'running' });
    redraw((n) => n + 1);
    const queue = jumps.filter((jump) => jump.input);
    // A few at a time: the service limits the rate, and the client retries on 429.
    const worker = async () => {
      for (let jump = queue.shift(); jump; jump = queue.shift()) {
        const result = await classifyWithJev(jump.input!, { client });
        runs.set(jump, { state: 'done', result });
        redraw((n) => n + 1);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  };

  const run = j ? runs.get(j) : undefined;
  const busy = skills.jumps.some((x) => runs.get(x)?.state === 'running');
  const doneAll = skills.jumps.flatMap((x) => {
    const r = runs.get(x);
    return r?.state === 'done' && r.result.status === 'ok' ? [r.result] : [];
  });

  return (
    <>
      <section className="coach__lead">
        <p className="coach__para">{t('coach.jev.intro')}</p>
        {!JEV_URL && <Banner tone="warning">{t('coach.jev.notInBuild')}</Banner>}
        <Field label={t('coach.jev.key')} hint={t('coach.jev.keyHint')}>
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            disabled={!JEV_URL}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
        <div className="coach__actions">
          <Button
            size="sm"
            variant="primary"
            disabled={!client || !j?.input || busy}
            onClick={() => j && void ask([j])}
          >
            {busy ? t('coach.jev.running') : t('coach.jev.run')}
          </Button>{' '}
          <Button
            size="sm"
            disabled={!client || busy || skills.jumps.length < 2}
            onClick={() => void ask(skills.jumps)}
          >
            {t('coach.jev.runAll', { n: skills.jumps.length })}
          </Button>
        </div>
        <p className="coach__note">{t('coach.jev.privacy')}</p>
      </section>

      {!j ? (
        <p className="coach__empty">{t('coach.noJump')}</p>
      ) : !run ? (
        <p className="coach__quiet">{t('coach.jev.notAsked')}</p>
      ) : run.state === 'running' ? (
        <p className="coach__quiet" role="status">
          {t('coach.jev.waiting')}
        </p>
      ) : (
        <Comparison jump={j} r={run.result} />
      )}

      {doneAll.length > 1 && <Summary skills={skills} />}
    </>
  );
}

/** The two answers for the selected jump: the element, the four parts, the five best, and why. */
function Comparison({ jump, r }: { jump: JumpSkillResult; r: JevResult }) {
  if (r.status !== 'ok') {
    return (
      <Group title={t('coach.jev.comparison')}>
        <Banner tone="warning">{t('coach.jev.unavailable', { error: r.error ?? '' })}</Banner>
        <p className="coach__note">{t('coach.jev.localKept', { name: skillName(jump.prediction) })}</p>
      </Group>
    );
  }
  const { parts, top, agree } = compareLines(r);
  const localName = skillName(jump.prediction);
  const jevName = nameOf(r.jevElementId);
  return (
    <Group
      title={t('coach.jev.comparison')}
      meta={
        agree === null ? null : (
          <Badge tone={agree ? 'ok' : 'warn'}>{agree ? t('coach.jev.agree') : t('coach.jev.differ')}</Badge>
        )
      }
    >
      <div className="coach__scroll">
        <table className="coach__table">
          <thead>
            <tr>
              <th scope="col" className="coach__th coach__th--lead" />
              <th scope="col" className="coach__th">
                {t('coach.jev.local')}
              </th>
              <th scope="col" className="coach__th">
                Jev
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="coach__td coach__td--lead coach__td--name">
                {t('coach.jev.element')}
              </th>
              <td className="coach__td">{localName}</td>
              <td className="coach__td">{jevName}</td>
            </tr>
            <tr>
              <th scope="row" className="coach__td coach__td--lead coach__td--name">
                {t('coach.classifierConfidence')}
              </th>
              <td className="coach__td num">{pct(jump.prediction.confidence)}</td>
              <td className="coach__td num">{pct(r.candidates[0]?.mass ?? 0)}</td>
            </tr>
            {parts.map((p) => (
              <tr key={p.key}>
                <th scope="row" className="coach__td coach__td--lead coach__td--name">
                  {p.label}
                </th>
                <td className="coach__td num">{p.local}</td>
                <td className="coach__td num">{p.jev}</td>
              </tr>
            ))}
            {top.map((p) => (
              <tr key={p.key}>
                <th scope="row" className="coach__td coach__td--lead coach__td--name">
                  {t('coach.jev.rank', { n: p.label })}
                </th>
                <td className="coach__td">{p.local}</td>
                <td className="coach__td">{p.jev}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.problems.length > 0 && (
        <p className="coach__note">{t('coach.jev.doubtful', { problems: r.problems.join('; ') })}</p>
      )}
      {r.outOfTable && <p className="coach__note">{t('coach.jev.outOfTable', { answer: r.outOfTable })}</p>}
      <p className="coach__note">
        {t('coach.jev.final', {
          name: nameOf(r.final.elementId),
          source: r.final.source === 'jev' ? 'Jev' : t('coach.jev.local'),
        })}
      </p>
      <p className="coach__note num">{t('coach.jev.cost', { ms: r.latencyMs, tokens: r.usage?.input_tokens ?? 0 })}</p>
    </Group>
  );
}

/** Over the jumps asked so far: how often the two agree, and where they differ. */
function Summary({ skills }: { skills: SkillAnalysis }) {
  const rows = skills.jumps.flatMap((jump, i) => {
    const run = runs.get(jump);
    return run?.state === 'done' && run.result.status === 'ok' ? [{ i, jump, r: run.result }] : [];
  });
  const differ = rows.filter(({ r }) => compareLines(r).agree === false);
  return (
    <Group
      title={t('coach.jev.summary')}
      meta={
        <span className="num">
          {rows.length - differ.length}/{rows.length}
        </span>
      }
    >
      <p className="coach__note">
        {t('coach.jev.summaryNote', { same: rows.length - differ.length, total: rows.length })}
      </p>
      {differ.map(({ i, jump, r }) => (
        <p key={i} className="coach__note">
          {t('coach.jumpMessage', {
            n: i + 1,
            message: `${t('coach.jev.local')}: ${skillName(jump.prediction)} · Jev: ${nameOf(r.jevElementId)}`,
          })}
        </p>
      ))}
    </Group>
  );
}
