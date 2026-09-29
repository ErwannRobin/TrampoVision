import type { SkillAnalysis } from '../../../skills/analyzeSkills';
import { KNOWN_LIMITS } from '../../../skills/classifier';
import { DEFAULT_SKILL_CONFIG, type SkillConfig } from '../../../skills/config';
import { pct } from '../../format';
import { confidenceTier, skillName, TIER_TEXT } from '../../insights';
import { Button, ConfidenceMeter, cx, Disclosure, NumberField, SelectField } from '../../kit';
import { fig, row } from './figures';
import { Group, Limits, Rows } from './parts';
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
        <p className="coach__note">
          Heuristic score, not a probability. Classifier: {p.classifier.id} v{p.classifier.version}.
        </p>
      </section>

      {p.evidence.length > 0 && (
        <Group title="Evidence">
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
