import { useState } from 'react';
import { t } from '../../../i18n';
import type { SkillAnalysis } from '../../../skills/analyzeSkills';
import { knownLimits } from '../../../skills/classifier';
import { CHECK_MARK, diagnoseUnclassified, formatClassificationDebug, movementText } from '../../../skills/debug';
import { DEFAULT_SKILL_CONFIG, type SkillConfig } from '../../../skills/config';
import { pct } from '../../format';
import { confidenceTier, skillName, TIER_TEXT } from '../../insights';
import { Button, ConfidenceMeter, cx, Disclosure, NumberField, SelectField } from '../../kit';
import type { SkillPrediction } from '../../../skills/types';
import { fig, row } from './figures';
import { Group, Limits, Rows } from './parts';
import { TrajectoryCompare } from './TrajectoryCompare';
import { facingOptions, THRESHOLD_FIELDS } from './thresholds';

interface Props {
  skills: SkillAnalysis;
  selected: number;
  config: SkillConfig;
  onConfig: (config: SkillConfig) => void;
}

/** A label longer than this wraps in the headline size, so it is set smaller. */
const LONG_LABEL = 20;

/** The predicted skill of the selected jump: the answer, the numbers behind it, and what the data could not settle. */
export function SkillTab({ skills, selected, config, onConfig }: Props) {
  const j = skills.jumps[Math.min(selected, skills.jumps.length - 1)];
  if (!j) {
    return (
      <>
        <p className="coach__empty">{t('coach.noJump')}</p>
        <div className="coach__more">
          <KnownLimits />
        </div>
      </>
    );
  }
  const p = j.prediction;
  const tier = confidenceTier(p, skills.config.minConfidence);

  return (
    <>
      <section className="coach__lead">
        <h2 className={cx('coach__skill t-brand', skillName(p).length > LONG_LABEL && 'coach__skill--long')}>
          {skillName(p)}
        </h2>
        <div className="coach__conf">
          <span className="coach__tier">{TIER_TEXT[tier]}</span>
          <span className="coach__pct num">{pct(p.confidence)}</span>
        </div>
        <ConfidenceMeter value={p.confidence} tier={tier} label={t('coach.classifierConfidence')} />
        <p>{p.summary}</p>
        {p.certainty === 'tentative' && <p className="coach__note">{t('coach.tentative')}</p>}
        <p className="coach__note">{t('coach.heuristic', { id: p.classifier.id, version: p.classifier.version })}</p>
      </section>

      <ClassificationDebug p={p} skills={skills} />

      {p.evidence.length > 0 && (
        <Group title={t('coach.measurements')}>
          <Rows rows={p.evidence.map((e) => row(e.key, e.label, fig(e.text), e.note))} />
        </Group>
      )}

      {p.limitations.length > 0 ? (
        <Group title={t('coach.couldNotSettle')}>
          <Limits items={p.limitations} />
        </Group>
      ) : (
        <p className="coach__quiet">{t('coach.noProblemSee')}</p>
      )}

      <div className="coach__more">
        {p.confidenceParts.length > 0 && (
          <Disclosure title={t('coach.productOf')}>
            <Rows rows={p.confidenceParts.map((c) => row(c.name, c.name, fig(pct(c.value))))} />
          </Disclosure>
        )}
        <Thresholds config={config} onConfig={onConfig} />
        <KnownLimits />
      </div>
    </>
  );
}

/** The classification explained: the movement, one check per question, the alternatives, and the unclassified jumps of the clip. */
function ClassificationDebug({ p, skills }: { p: SkillPrediction; skills: SkillAnalysis }) {
  const cands = p.candidates;
  if (!cands || cands.length === 0) return null;
  const named = p.skill !== 'unclassified';
  const top = cands[0];
  const alternatives = cands.slice(named ? 1 : 0, named ? 5 : 3);
  const unclassified = diagnoseUnclassified(skills);
  return (
    <>
      <Group title={named ? t('coach.movement') : t('coach.closestElement')}>
        <Rows
          rows={[
            row('predicted', named ? t('coach.predicted') : t('coach.closest'), fig(named ? p.label : top.name)),
            ...(named ? [row('movement', t('coach.movement'), fig(movementText(p)))] : []),
            ...top.checks.map((c) =>
              row(
                `check_${c.stage}`,
                `${CHECK_MARK[c.status]} ${c.criterion}`,
                fig(c.observed, undefined, c.status === 'unmeasured'),
                c.status === 'unmeasured'
                  ? t('coach.notMeasuredAssumed', { expected: c.expected })
                  : t('coach.elementNeeds', { expected: c.expected }),
              ),
            ),
          ]}
        />
        {p.failure && <p className="coach__note">{p.failure.message}</p>}
        {p.failure?.ifResolved != null && (
          <p className="coach__note">
            {t('coach.ifCertain', {
              criterion: t(`criterion.${p.failure.criterion}`),
              name: p.failure.closest?.name ?? '',
              score: pct(p.failure.ifResolved),
            })}
          </p>
        )}
      </Group>
      {alternatives.length > 0 && (
        <Group title={t('coach.alternatives')}>
          <Rows
            rows={alternatives.map((c) =>
              row(
                c.elementId,
                c.name,
                fig(pct(c.score ?? c.posterior)),
                c.similarity === undefined ? undefined : t('coach.trajectoryMatch', { sim: pct(c.similarity) }),
              ),
            )}
          />
        </Group>
      )}
      {p.comparison && (
        <Group title={t('coach.againstReference')} meta={<span className="num">{pct(p.comparison.similarity)}</span>}>
          <TrajectoryCompare comparison={p.comparison} />
          <p className="coach__note">
            {t(p.comparison.referenceKind === 'example' ? 'coach.compareNoteExample' : 'coach.compareNoteModel', {
              name: top.name,
            })}
          </p>
        </Group>
      )}
      <div className="coach__more">
        {p.stages && (
          <Disclosure title={t('coach.answerOfEach')}>
            {p.stages.map((st) => (
              <Rows
                key={st.stage}
                rows={[
                  row(st.stage, st.title, fig(st.observed, undefined, !st.measured), st.notes.join('. ') || undefined),
                  ...st.distribution
                    .slice(0, 3)
                    .map((d) => row(`${st.stage}_${d.label}`, `  ${d.label}`, fig(pct(d.p)))),
                ]}
              />
            ))}
            {p.outOfTable !== undefined && (
              <p className="coach__note">{t('coach.outsideTable', { share: pct(p.outOfTable) })}</p>
            )}
          </Disclosure>
        )}
        {unclassified.unclassified > 0 && (
          <Disclosure title={t('coach.unclassifiedIn', { n: unclassified.unclassified, total: unclassified.total })}>
            <Rows rows={unclassified.byKind.map((b) => row(b.kind, t(`failure.${b.kind}`), fig(String(b.count))))} />
            {unclassified.jumps.map((r) => (
              <p key={r.jump} className="coach__note">
                {t('coach.jumpMessage', { n: r.jump + 1, message: r.message })}
                {r.top.length > 0 &&
                  `${t('sentence.gap')}${r.top.map((c) => `${c.name} ${pct(c.posterior)}`).join(' · ')}.`}
              </p>
            ))}
          </Disclosure>
        )}
        <Disclosure title={t('coach.debugText')}>
          <CopyButton text={formatClassificationDebug(p)} />
          <pre className="coach__note">{formatClassificationDebug(p)}</pre>
        </Disclosure>
      </div>
    </>
  );
}

/** Copies a text to the clipboard and says so for a moment; falls back to a selection when the clipboard is blocked. */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2000);
  };
  return (
    <Button size="sm" onClick={copy} aria-live="polite">
      {state === 'copied' ? t('coach.copied') : state === 'failed' ? t('coach.copyFailedSelect') : t('coach.copyDebug')}
    </Button>
  );
}

function Thresholds({ config, onConfig }: { config: SkillConfig; onConfig: (config: SkillConfig) => void }) {
  return (
    <Disclosure title={t('coach.thresholds')}>
      <div className="coach__fields">
        {THRESHOLD_FIELDS.map((f) => (
          <NumberField
            key={f.label}
            className="coach__nf"
            label={f.label}
            unit={f.unit}
            step={1}
            value={f.get(config)}
            onChange={(v) => onConfig(f.set(config, v))}
          />
        ))}
      </div>
      <SelectField
        className="coach__facing"
        label={t('coach.athleteFaces')}
        hint={t('coach.athleteFacesHint')}
        value={config.facing.override}
        options={facingOptions()}
        onChange={(override) => onConfig({ ...config, facing: { ...config.facing, override } })}
      />
      <div className="coach__actions">
        <Button size="sm" onClick={() => onConfig(DEFAULT_SKILL_CONFIG)}>
          {t('coach.resetThresholds')}
        </Button>
      </div>
      <p className="coach__note">{t('coach.thresholdsNote')}</p>
    </Disclosure>
  );
}

function KnownLimits() {
  return (
    <Disclosure title={t('coach.knownLimits')}>
      <Limits items={knownLimits()} />
    </Disclosure>
  );
}
