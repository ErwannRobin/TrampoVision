import type { SkillAnalysis } from '../../../skills/analyzeSkills';
import { KNOWN_LIMITS } from '../../../skills/classifier';
import { CHECK_MARK, diagnoseUnclassified, formatClassificationDebug, movementText } from '../../../skills/debug';
import { DEFAULT_SKILL_CONFIG, type SkillConfig } from '../../../skills/config';
import { pct } from '../../format';
import { confidenceTier, skillName, TIER_TEXT } from '../../insights';
import { Button, ConfidenceMeter, cx, Disclosure, NumberField, SelectField } from '../../kit';
import type { SkillPrediction } from '../../../skills/types';
import { fig, row } from './figures';
import { Group, Limits, Rows } from './parts';
import { TrajectoryCompare } from './TrajectoryCompare';
import { FACING_OPTIONS, THRESHOLD_FIELDS } from './thresholds';

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
        <p className="coach__empty">No jump found: the center of mass never rose 0.3 m above its surroundings.</p>
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
        <ConfidenceMeter value={p.confidence} tier={tier} label="Classifier confidence" />
        <p>{p.summary}</p>
        {p.certainty === 'tentative' && (
          <p className="coach__note">
            Tentative guess: weakly supported, shown so it can be checked. The alternatives below say what else it may
            be.
          </p>
        )}
        <p className="coach__note">
          Heuristic score, not a probability. Classifier: {p.classifier.id} v{p.classifier.version}.
        </p>
      </section>

      <ClassificationDebug p={p} skills={skills} />

      {p.evidence.length > 0 && (
        <Group title="Measurements">
          <Rows rows={p.evidence.map((e) => row(e.key, e.label, fig(e.text), e.note))} />
        </Group>
      )}

      {p.limitations.length > 0 ? (
        <Group title="What the data could not settle">
          <Limits items={p.limitations} />
        </Group>
      ) : (
        <p className="coach__quiet">
          No data problem found for this jump. Some things are never measured from one side view: see the list below.
        </p>
      )}

      <div className="coach__more">
        {p.confidenceParts.length > 0 && (
          <Disclosure title="Confidence is the product of">
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
      <Group title={named ? 'Movement' : 'Closest element'}>
        <Rows
          rows={[
            row('predicted', named ? 'Predicted' : 'Closest', fig(named ? p.label : top.name)),
            ...(named ? [row('movement', 'Movement', fig(movementText(p)))] : []),
            ...top.checks.map((c) =>
              row(
                `check_${c.stage}`,
                `${CHECK_MARK[c.status]} ${c.criterion}`,
                fig(c.observed, undefined, c.status === 'unmeasured'),
                c.status === 'unmeasured' ? `not measured; ${c.expected} assumed` : `element needs ${c.expected}`,
              ),
            ),
          ]}
        />
        {p.failure && <p className="coach__note">{p.failure.message}</p>}
        {p.failure?.ifResolved != null && (
          <p className="coach__note">
            If the {p.failure.criterion} were certain, {p.failure.closest?.name} would score {pct(p.failure.ifResolved)}
            .
          </p>
        )}
      </Group>
      {alternatives.length > 0 && (
        <Group title="Alternatives">
          <Rows
            rows={alternatives.map((c) =>
              row(
                c.elementId,
                c.name,
                fig(pct(c.score ?? c.posterior)),
                c.similarity === undefined ? undefined : `trajectory match ${pct(c.similarity)}`,
              ),
            )}
          />
        </Group>
      )}
      {p.comparison && (
        <Group
          title="Jump against the closest reference"
          meta={<span className="num">{pct(p.comparison.similarity)}</span>}
        >
          <TrajectoryCompare comparison={p.comparison} />
          <p className="coach__note">
            Solid: this jump. Dashed:{' '}
            {p.comparison.referenceKind === 'example' ? 'a jump you labelled' : 'the expected movement'} for {top.name},
            warped in time to fit. Distances are in tolerances: 1 is a normal difference.
          </p>
        </Group>
      )}
      <div className="coach__more">
        {p.stages && (
          <Disclosure title="Answer of each question">
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
              <p className="coach__note">Outside the element table: {pct(p.outOfTable)} of the probability.</p>
            )}
          </Disclosure>
        )}
        {unclassified.unclassified > 0 && (
          <Disclosure title={`Unclassified in this clip (${unclassified.unclassified} of ${unclassified.total})`}>
            <Rows
              rows={unclassified.byKind.map((b) => row(b.kind, b.kind.replaceAll('-', ' '), fig(String(b.count))))}
            />
            {unclassified.jumps.map((r) => (
              <p key={r.jump} className="coach__note">
                Jump {r.jump + 1}: {r.message}
                {r.top.length > 0 && ` ${r.top.map((t) => `${t.name} ${pct(t.posterior)}`).join(' · ')}.`}
              </p>
            ))}
          </Disclosure>
        )}
        <Disclosure title="Debug text">
          <pre className="coach__note">{formatClassificationDebug(p)}</pre>
        </Disclosure>
      </div>
    </>
  );
}

function Thresholds({ config, onConfig }: { config: SkillConfig; onConfig: (config: SkillConfig) => void }) {
  return (
    <Disclosure title="Thresholds">
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
        label="Athlete faces"
        hint="Which way the athlete faces when upright. Needed to tell front from back."
        value={config.facing.override}
        options={FACING_OPTIONS}
        onChange={(override) => onConfig({ ...config, facing: { ...config.facing, override } })}
      />
      <div className="coach__actions">
        <Button size="sm" onClick={() => onConfig(DEFAULT_SKILL_CONFIG)}>
          Reset thresholds
        </Button>
      </div>
      <p className="coach__note">
        Starting values are estimates, not tuned on real athletes. Change them and watch the position strip and the
        prediction update.
      </p>
    </Disclosure>
  );
}

function KnownLimits() {
  return (
    <Disclosure title="What one side view can never tell">
      <Limits items={KNOWN_LIMITS} />
    </Disclosure>
  );
}
