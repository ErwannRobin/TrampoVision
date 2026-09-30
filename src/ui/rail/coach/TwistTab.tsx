import { useEffect, useState } from 'react';
import { sampleIndexAt } from '../../../analysis/lookup';
import type { AnalysisResult } from '../../../analysis/types';
import { describeSupport, probeCapabilities, type Capabilities } from '../../../pose3d/capabilities';
import { DEFAULT_TWIST_CONFIG } from '../../../pose3d/config';
import type { TwistAnalysis, TwistEstimate } from '../../../pose3d/twist';
import { t, tp } from '../../../i18n';
import { DASH, fmt, pct, signed } from '../../format';
import { Badge, ConfidenceMeter, Disclosure, SelectField } from '../../kit';
import { usePlayheadTime, type Playhead } from '../../playhead';
import { fig, row } from './figures';
import { Group, Limits, Row, RowList, Rows } from './parts';
import {
  cameraLimits,
  capabilityRows,
  checkRows,
  crossRows,
  halfTwistOption,
  twistSummaryRows,
  twistTiltRow,
} from './twistFigures';

interface Props {
  result: AnalysisResult;
  /** Null when there is no pose track to read 3D landmarks from. */
  twist: TwistAnalysis | null;
  /** Selected jump, 0-based. */
  selected: number;
  playhead: Playhead;
  /** The annotator's count of half twists for the selected jump, if any. */
  annotation: number | null;
  onAnnotate: (halfTwists: number | null) => void;
  canAnnotate: boolean;
}

const annotationOptions = () => [
  { value: '', label: t('twist.notCounted') },
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({ value: String(v), label: halfTwistOption(v) })),
];

/** What the browser can do does not change while the page is open: ask once. */
let probed: Promise<Capabilities> | null = null;
const capabilities = () => (probed ??= probeCapabilities());

function useCapabilities(): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    let live = true;
    void capabilities().then((c) => live && setCaps(c));
    return () => {
      live = false;
    };
  }, []);
  return caps;
}

/** Twist of the selected jump: the number (or the reason there is none), the checks behind it, and what the 3D data cannot tell. */
export function TwistTab({ result, twist, selected, playhead, annotation, onAnnotate, canAnnotate }: Props) {
  const k = Math.min(selected, Math.max(0, (twist?.jumps.length ?? 0) - 1));
  const e = twist?.jumps[k];
  return (
    <>
      <div className="coach__title">
        <h2 className="coach__h2">{t('twist.title')}</h2>
        <Badge tone="outline">{t('twist.experimental')}</Badge>
      </div>

      {!twist ? (
        <p className="coach__empty">{t('twist.noWorld')}</p>
      ) : !e ? (
        <p className="coach__empty">{t('twist.noJump')}</p>
      ) : (
        <>
          <Verdict e={e} minConfidence={twist.config.minConfidence} />
          {e.available && (
            <JumpTwist
              result={result}
              twist={twist}
              e={e}
              jump={k}
              playhead={playhead}
              annotation={annotation}
              onAnnotate={onAnnotate}
              canAnnotate={canAnnotate}
            />
          )}
        </>
      )}

      <div className="coach__more">
        <Disclosure title={t('twist.cameraLimits')}>
          <Limits items={cameraLimits(result.meta.fps, twist?.config.maxStepDeg ?? DEFAULT_TWIST_CONFIG.maxStepDeg)} />
        </Disclosure>
        <Readiness hasWorld={!!twist?.frames} />
      </div>
    </>
  );
}

/** The answer: the estimate when it can be trusted, and the reason when it cannot. */
function Verdict({ e, minConfidence }: { e: TwistEstimate; minConfidence: number }) {
  if (!e.available) {
    const why = e.limitations[0];
    return (
      <section className="coach__lead">
        <h3 className="coach__verdict">{t('twist.notMeasured')}</h3>
        {why && (
          <>
            <p>{why.problem}</p>
            <p>
              <em>{t('coach.needed')}</em> {why.needed}
            </p>
          </>
        )}
      </section>
    );
  }
  return (
    <section className="coach__lead">
      {e.reliable ? (
        <>
          <div className="coach__result">
            <span className="coach__big num">≈ {e.twists ?? DASH}</span>
            <span className="coach__result-unit">{tp('twist.unit', e.twists ?? 0)}</span>
          </div>
          <p className="coach__quiet">
            <span className="num">{e.halfTwists ?? DASH}</span> {tp('twist.halfUnit', e.halfTwists ?? 0)}
          </p>
        </>
      ) : (
        <h3 className="coach__verdict">{t('twist.notReliable')}</h3>
      )}
      <div className="coach__conf">
        <span className="coach__tier">{t('twist.consistency')}</span>
        <span className="coach__readings">
          <span className="coach__pct num">{pct(e.confidence)}</span>
          {!e.reliable && <span className="coach__extra">{t('twist.belowMin', { min: pct(minConfidence) })}</span>}
        </span>
      </div>
      <ConfidenceMeter value={e.confidence} tier={e.reliable ? 'high' : 'low'} label={t('twist.consistencyLabel')} />
      {!e.reliable && <p className="coach__caution">{t('twist.rawCaution')}</p>}
      <p className="coach__note">{t('twist.consistencyNote')}</p>
    </section>
  );
}

interface JumpTwistProps extends Omit<Props, 'twist' | 'selected'> {
  twist: TwistAnalysis;
  e: TwistEstimate;
  jump: number;
}

/** Everything under the answer, for a jump whose twist could be computed. */
function JumpTwist({ result, twist, e, jump, playhead, annotation, onAnnotate, canAnnotate }: JumpTwistProps) {
  const checks = checkRows(e.parts);
  const weak = checks.filter((c) => c.weak).length;
  const counted = annotation !== null && e.halfTwists !== null;
  const same = annotation === e.halfTwists;
  return (
    <>
      <Group title={e.reliable ? t('twist.measured') : t('twist.raw')}>
        <dl className="coach__rows">
          <RowList rows={twistSummaryRows(e)} />
          <TwistNow result={result} twist={twist} jump={jump} playhead={playhead} />
          <RowList rows={[twistTiltRow(e)]} />
        </dl>
      </Group>

      <Group title={t('twist.sameRoutes')}>
        <Rows rows={crossRows(e)} />
      </Group>

      <div className="coach__more">
        <Disclosure title={t('twist.checksBehind')} meta={t('twist.weakCount', { n: weak })} defaultOpen={!e.reliable}>
          <dl className="coach__rows">
            {checks.map((c) => (
              <Row key={c.key} label={c.label}>
                {c.weak && <Badge tone="warn">{t('twist.weak')}</Badge>}
                <span className="coach__fig">
                  <span className="num">{c.value}</span>
                </span>
              </Row>
            ))}
          </dl>
        </Disclosure>
      </div>

      {e.limitations.length > 0 ? (
        <Group title={t('twist.couldNotSettle')}>
          <Limits items={e.limitations} />
        </Group>
      ) : (
        <p className="coach__quiet">{t('twist.noProblem')}</p>
      )}

      <Group title={t('twist.checkAgainst')}>
        <SelectField
          label={t('twist.countLabel')}
          hint={canAnnotate ? undefined : t('twist.cannotSave')}
          value={annotation === null ? '' : String(annotation)}
          disabled={!canAnnotate}
          options={annotationOptions()}
          onChange={(v) => onAnnotate(v === '' ? null : Number(v))}
        />
        {counted && (
          <dl className="coach__rows coach__compare">
            <Row label={t('twist.youCounted')} figures={[fig(String(annotation), tp('twist.halfUnit', annotation))]} />
            <Row
              label={t('twist.estimate')}
              figures={[fig(String(e.halfTwists ?? 0), tp('twist.halfUnit', e.halfTwists ?? 0))]}
            >
              <Badge tone={same ? 'ok' : 'warn'}>{same ? t('twist.same') : t('twist.different')}</Badge>
            </Row>
          </dl>
        )}
        {counted && !e.reliable && <p className="coach__quiet">{t('twist.flagged')}</p>}
        <p className="coach__note">{t('twist.annotationNote')}</p>
      </Group>
    </>
  );
}

/** The two rows that follow the playhead, sitting among the static ones. */
function TwistNow({
  result,
  twist,
  jump,
  playhead,
}: {
  result: AnalysisResult;
  twist: TwistAnalysis;
  jump: number;
  playhead: Playhead;
}) {
  const time = usePlayheadTime(playhead);
  const i = sampleIndexAt(result.meta, time);
  const frames = twist.frames;
  const takeoff = result.jumps.cycles[jump]?.takeoff ?? null;
  const since = frames && takeoff !== null ? frames.angle[i] - frames.angle[takeoff] : NaN;
  return (
    <RowList
      rows={[
        row('since-takeoff', t('twist.sinceTakeoff'), fig(signed(since, 0), '°')),
        row('speed-now', t('twist.speedNow'), fig(fmt(frames?.angularVelocity[i], 0), '°/s')),
      ]}
    />
  );
}

function Readiness({ hasWorld }: { hasWorld: boolean }) {
  const caps = useCapabilities();
  const support = caps ? describeSupport(caps, hasWorld) : null;
  return (
    <Disclosure title={t('twist.readiness')}>
      {!caps || !support ? (
        <p className="coach__quiet">{t('twist.checking')}</p>
      ) : (
        <>
          <Rows rows={capabilityRows(caps)} />
          <p className="coach__para">
            <strong>{t('twist.modelInUse')}</strong> {support.current.text}
          </p>
          <p className="coach__para">
            <strong>{t('twist.separateModel')}</strong> {support.dedicated.text}
          </p>
          <p className="coach__note">{t('twist.mediapipeNote')}</p>
        </>
      )}
    </Disclosure>
  );
}
