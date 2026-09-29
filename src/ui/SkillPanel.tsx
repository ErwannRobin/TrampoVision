import { sampleIndexAt } from '../analysis/lookup';
import { JUMP_PHASES } from '../analysis/jumpCycles';
import type { AnalysisResult } from '../analysis/types';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { KNOWN_LIMITS } from '../skills/classifier';
import { DEFAULT_SKILL_CONFIG, type SkillConfig } from '../skills/config';
import { POSITIONS, type JumpFeatures } from '../skills/types';
import { Playhead, usePlayheadTime } from './playhead';

const pct = (v: number) => `${Math.round(Math.min(Math.max(v, 0), 1) * 100)}%`;
const f = (v: number | null | undefined, d = 1, unit = '') =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '–'
    : `${Number(v.toFixed(d)) === 0 ? (0).toFixed(d) : v.toFixed(d)}${unit}`;

interface Props {
  result: AnalysisResult;
  skills: SkillAnalysis;
  selected: number;
  playhead: Playhead;
  config: SkillConfig;
  onConfig: (next: SkillConfig) => void;
  onSelect: (jump: number) => void;
}

/** Predicted skill of the selected jump: the answer, the numbers behind it, and what the data could not tell. */
export function SkillPanel({ result, skills, selected, playhead, config, onConfig, onSelect }: Props) {
  const time = usePlayheadTime(playhead);
  if (skills.jumps.length === 0) {
    return (
      <div className="metrics skill">
        <h3>Predicted skill</h3>
        <p className="muted small">No jump found: the center of mass never rose 0.3 m above its surroundings.</p>
        <Known />
      </div>
    );
  }
  const j = skills.jumps[Math.min(selected, skills.jumps.length - 1)];
  const p = j.prediction;
  const feat = j.features;
  const i = sampleIndexAt(result.meta, time);
  const inJump = result.jumps.cycleIndex[i] === j.cycle.index;
  const good = p.skill !== 'unclassified' && p.confidence >= 0.6;

  return (
    <div className="metrics skill">
      <h3>
        Predicted skill
        <span className="muted mono">
          {skills.jumps.length > 1 && (
            <>
              <button
                className="tiny"
                disabled={j.cycle.index === 0}
                onClick={() => onSelect(j.cycle.index - 1)}
                aria-label="Previous jump"
              >
                ‹
              </button>{' '}
              jump {j.cycle.index + 1} / {skills.jumps.length}{' '}
              <button
                className="tiny"
                disabled={j.cycle.index === skills.jumps.length - 1}
                onClick={() => onSelect(j.cycle.index + 1)}
                aria-label="Next jump"
              >
                ›
              </button>
            </>
          )}
        </span>
      </h3>

      <div className={`skillcard ${good ? 'good' : 'weak'}`}>
        <div className="skillname">Skill: {p.label}</div>
        <div className="skillconf">Confidence: {pct(p.confidence)}</div>
        <div className="confbar" aria-hidden>
          <div style={{ width: pct(p.confidence) }} />
        </div>
        <p className="small">{p.summary}</p>
        <p className="muted small">
          Heuristic score, not a probability. Classifier: {p.classifier.id} v{p.classifier.version}.
        </p>
      </div>

      <h3>Evidence</h3>
      <ul className="evidence">
        {p.evidence.map((e) => (
          <li key={e.key} title={e.note}>
            <span className="ev-label">{e.label}:</span> <span className="mono">{e.text}</span>
            {e.note && <div className="muted small">{e.note}</div>}
          </li>
        ))}
      </ul>

      {p.confidenceParts.length > 0 && (
        <details>
          <summary>Confidence is the product of</summary>
          <table className="mono">
            <tbody>
              {p.confidenceParts.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>{pct(c.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {p.limitations.length > 0 ? (
        <>
          <h3>What the data could not settle</h3>
          <ul className="warnings limits">
            {p.limitations.map((l) => (
              <li key={l.signal + l.problem}>
                <strong>{l.signal}.</strong> {l.problem}
                <div>
                  <em>Needed:</em> {l.needed}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted small">
          No data problem found for this jump. (Some things are never measured from one side view: see the list below.)
        </p>
      )}

      <h3>Now {inJump ? '' : <span className="muted">(playhead is outside this jump)</span>}</h3>
      <Live result={result} skills={skills} feat={feat} sample={i} inJump={inJump} />

      <h3>Key measurements</h3>
      <Measurements feat={feat} calibrated={result.meta.calibrated} />

      <Thresholds config={config} onConfig={onConfig} />
      <Known />
    </div>
  );
}

function Live({
  result,
  skills,
  feat,
  sample,
  inJump,
}: {
  result: AnalysisResult;
  skills: SkillAnalysis;
  feat: JumpFeatures;
  sample: number;
  inJump: boolean;
}) {
  const phase = JUMP_PHASES[result.jumps.phase[sample]];
  const fr = skills.frames;
  return (
    <dl className="mono">
      <dt>Jump phase</dt>
      <dd>
        <span className={`phase phase-${phase}`}>{phase}</span>
      </dd>
      <dt>Body position</dt>
      <dd>{inJump ? POSITIONS[fr.position[sample]] : '–'}</dd>
      <dt>Hip angle</dt>
      <dd>{inJump ? f(fr.hipAngle[sample], 0, '°') : '–'}</dd>
      <dt>Knee angle</dt>
      <dd>{inJump ? f(fr.kneeAngle[sample], 0, '°') : '–'}</dd>
      <dt>Rotation so far</dt>
      <dd>{inJump ? f(result.jumps.turnsSinceTakeoff[sample], 2, ' turns') : '–'}</dd>
      <dt>Rotation, whole jump</dt>
      <dd>{f(feat.rotation.turns, 2, ' turns')}</dd>
    </dl>
  );
}

function Measurements({ feat, calibrated }: { feat: JumpFeatures; calibrated: boolean }) {
  const t = feat.timing;
  const tr = feat.trajectory;
  const o = feat.orientation;
  const s = feat.shape;
  const r = feat.rotation;
  return (
    <dl className="mono">
      <dt>Flight time</dt>
      <dd>{f(t.flightTimeS, 2, ' s')}</dd>
      <dt>Time to apex</dt>
      <dd>{f(t.timeToApexS, 2, ' s')}</dd>
      <dt>Max height {calibrated ? 'above bed' : ''}</dt>
      <dd>{f(tr.maxHeightM, 2, ' m')}</dd>
      <dt>Height gained</dt>
      <dd>
        {f(tr.riseM, 2, ' m')}
        {tr.riseBodyLengths !== null && <span className="muted"> ({f(tr.riseBodyLengths, 2)} body lengths)</span>}
      </dd>
      <dt>Horizontal displacement</dt>
      <dd>{f(tr.horizontalDisplacementM, 2, ' m')}</dd>
      {calibrated && (
        <>
          <dt>Bed position takeoff → landing</dt>
          <dd>
            {f(tr.takeoffXBed, 2)} → {f(tr.landingXBed, 2)}
          </dd>
        </>
      )}
      <dt>Rotation</dt>
      <dd>
        {f(r.totalDeg, 0, '°')} ({r.direction})
      </dd>
      <dt>Rotation confidence</dt>
      <dd>{pct(r.confidence)}</dd>
      <dt>Peak angular velocity</dt>
      <dd>{f(o.peakAngularVelocityDps, 0, '°/s')}</dd>
      <dt>Orientation at apex</dt>
      <dd>{f(o.apexDeg, 0, '°')}</dd>
      <dt>Hip angle (min / at peak)</dt>
      <dd>
        {f(s.hipAngle.min, 0, '°')} / {f(s.hipAngle.atPeak, 0, '°')}
      </dd>
      <dt>Knee angle (min / at peak)</dt>
      <dd>
        {f(s.kneeAngle.min, 0, '°')} / {f(s.kneeAngle.atPeak, 0, '°')}
      </dd>
      <dt>Knees to torso</dt>
      <dd>{f(s.kneeTorsoDistance.atPeak, 2)} trunk lengths</dd>
      <dt>Compactness</dt>
      <dd>{f(s.compactness.atPeak, 2)}</dd>
      <dt title="Ankle distance / leg length. Barely visible from the side.">Leg separation</dt>
      <dd>{f(s.legSeparation.atPeak, 2)}</dd>
      <dt title="Angle between the shoulder line and the hip line. Not reliable in a side view.">
        Shoulder / hip axis
      </dt>
      <dd>{f(s.shoulderHipAxis.atPeak, 0, '°')}</dd>
      <dt>Facing</dt>
      <dd>
        {feat.facing.sign === 0 ? 'undetermined' : feat.facing.sign > 0 ? 'right' : 'left'} (
        {pct(feat.facing.confidence)})
      </dd>
      <dt>Pose quality in flight</dt>
      <dd>{pct(feat.quality.pose)}</dd>
    </dl>
  );
}

const NUM: {
  label: string;
  get: (c: SkillConfig) => number;
  set: (c: SkillConfig, v: number) => SkillConfig;
  step?: number;
  unit?: string;
}[] = [
  {
    label: 'Hip folded at or below',
    get: (c) => c.position.hipFoldedMaxDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, hipFoldedMaxDeg: v } }),
    unit: '°',
  },
  {
    label: 'Hip open at or above',
    get: (c) => c.position.hipOpenMinDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, hipOpenMinDeg: v } }),
    unit: '°',
  },
  {
    label: 'Knees bent at or below',
    get: (c) => c.position.kneeBentMaxDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, kneeBentMaxDeg: v } }),
    unit: '°',
  },
  {
    label: 'Legs straight at or above',
    get: (c) => c.position.kneeStraightMinDeg,
    set: (c, v) => ({ ...c, position: { ...c.position, kneeStraightMinDeg: v } }),
    unit: '°',
  },
  {
    label: 'Rotation tolerance',
    get: (c) => c.rotation.toleranceDeg,
    set: (c, v) => ({ ...c, rotation: { ...c.rotation, toleranceDeg: v } }),
    unit: '°',
  },
  {
    label: 'Minimum confidence',
    get: (c) => Math.round(c.minConfidence * 100),
    set: (c, v) => ({ ...c, minConfidence: v / 100 }),
    unit: '%',
  },
];

function Thresholds({ config, onConfig }: { config: SkillConfig; onConfig: (c: SkillConfig) => void }) {
  return (
    <details>
      <summary>Thresholds</summary>
      <dl className="mono thresholds">
        {NUM.map((n) => (
          <div key={n.label} className="row">
            <dt>{n.label}</dt>
            <dd>
              <input
                type="number"
                step={n.step ?? 1}
                value={n.get(config)}
                onChange={(e) =>
                  Number.isFinite(e.target.valueAsNumber) && onConfig(n.set(config, e.target.valueAsNumber))
                }
              />
              {n.unit}
            </dd>
          </div>
        ))}
        <div className="row">
          <dt title="Which way the athlete faces when upright. Needed to tell front from back.">Athlete faces</dt>
          <dd>
            <select
              value={config.facing.override}
              onChange={(e) =>
                onConfig({
                  ...config,
                  facing: { ...config.facing, override: e.target.value as SkillConfig['facing']['override'] },
                })
              }
            >
              <option value="auto">auto (from the pose)</option>
              <option value="left">left of the image</option>
              <option value="right">right of the image</option>
            </select>
          </dd>
        </div>
      </dl>
      <button onClick={() => onConfig(DEFAULT_SKILL_CONFIG)}>Reset thresholds</button>
      <p className="muted small">
        Starting values are my estimates, not tuned on real athletes. Adjust them and watch the position strip and the
        prediction change.
      </p>
    </details>
  );
}

function Known() {
  return (
    <details>
      <summary>What one side view can never tell</summary>
      <ul className="warnings limits">
        {KNOWN_LIMITS.map((l) => (
          <li key={l.signal}>
            <strong>{l.signal}.</strong> {l.problem}
            <div>
              <em>Needed:</em> {l.needed}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
