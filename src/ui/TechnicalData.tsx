import { useMemo, useState, type ReactNode } from 'react';
import type { CalibrationModel } from '../analysis/calibration';
import type { AnalysisResult, PoseTrack } from '../analysis/types';
import { t, useLocale } from '../i18n';
import type { TwistAnalysis } from '../pose3d/twist';
import type { SkillAnalysis } from '../skills/analyzeSkills';
import { Chart } from './Chart';
import { clipDecorations } from './charts/decorations';
import { confidenceSpec, jointSpecs, motionSpecs, rotationSpecs, twistSpecs, type ChartSpec } from './charts/specs';
import { Icon } from './kit';
import { JumpView } from './JumpView';
import type { Playhead } from './playhead';
import { TrajectoryPlot } from './TrajectoryPlot';

export interface TechnicalDataProps {
  result: AnalysisResult;
  skills: SkillAnalysis | null;
  track: PoseTrack | null;
  twist: TwistAnalysis | null;
  playhead: Playhead;
  /** Selected jump, 0-based. */
  selected: number;
  /** The bed model when the calibration is valid, to draw the bed under the path. */
  calibration: CalibrationModel | null;
  /** The evaluation report; the shell passes it only when it is relevant. */
  validation?: ReactNode;
}

/** A group of charts with a quiet heading. Closed groups render nothing: their charts do not exist until asked for. */
function Group({
  title,
  note,
  defaultOpen = false,
  children,
}: {
  title: string;
  note?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="tech__group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="tech__summary">
        <h3 className="tech__title">{title}</h3>
        {note && <span className="tech__note">{note}</span>}
        <Icon name="chevron-down" size={18} className="tech__chevron" />
      </summary>
      {open && <div className="tech__body">{children}</div>}
    </details>
  );
}

function Charts({ specs, playhead }: { specs: ChartSpec[]; playhead: Playhead }) {
  return (
    <div className="tech__grid">
      {specs.map((spec) => (
        <Chart key={spec.id} {...spec} playhead={playhead} />
      ))}
    </div>
  );
}

/**
 * Every curve of the analysis, for the coach: the selected jump on normalized axes, then the whole clip by theme.
 * Every chart follows the video, and a click or drag on one moves it.
 */
export function TechnicalData({
  result,
  skills,
  twist,
  playhead,
  selected,
  calibration,
  validation,
}: TechnicalDataProps) {
  // The charts carry their titles and units: they are made again when the language changes.
  const locale = useLocale();
  /* oxlint-disable react-hooks/exhaustive-deps */
  const deco = useMemo(() => clipDecorations(result, calibration), [result, calibration, locale]);
  const motion = useMemo(() => motionSpecs(result, deco), [result, deco, locale]);
  const rotation = useMemo(() => rotationSpecs(result, deco), [result, deco, locale]);
  const joints = useMemo(() => jointSpecs(result, deco), [result, deco, locale]);
  const confidence = useMemo(() => confidenceSpec(result, deco), [result, deco, locale]);
  const twistCharts = useMemo(
    () => (twist?.frames ? twistSpecs(result, twist.frames, deco) : []),
    [result, twist, deco, locale],
  );
  /* oxlint-enable react-hooks/exhaustive-deps */

  return (
    <section className="tech sheet" aria-labelledby="tech-title">
      <header className="tech__head">
        <h2 className="tech__h2" id="tech-title">
          {t('tech.title')}
        </h2>
        <p className="tech__lead">{t('tech.lead')}</p>
      </header>

      {skills && skills.jumps.length > 0 && (
        <Group title={t('tech.selectedJump')} note={t('tech.selectedJumpNote')} defaultOpen>
          <JumpView result={result} skills={skills} playhead={playhead} selected={selected} />
        </Group>
      )}
      <Group title={t('tech.motion')} defaultOpen>
        <div className="tech__grid tech__grid--path">
          <TrajectoryPlot result={result} playhead={playhead} calibration={calibration} />
          <div className="tech__stack">
            {motion.map((spec) => (
              <Chart key={spec.id} {...spec} playhead={playhead} />
            ))}
          </div>
        </div>
      </Group>
      <Group title={t('tech.rotation')}>
        <Charts specs={rotation} playhead={playhead} />
      </Group>
      <Group title={t('tech.joints')}>
        <Charts specs={joints} playhead={playhead} />
      </Group>
      <Group title={t('tech.confidence')}>
        <Charts specs={[confidence]} playhead={playhead} />
      </Group>
      {twistCharts.length > 0 && (
        <Group title={t('tech.twist')} note={t('tech.twistNote')}>
          <Charts specs={twistCharts} playhead={playhead} />
        </Group>
      )}
      {validation && (
        <Group title={t('tech.validation')} defaultOpen>
          {validation}
        </Group>
      )}
    </section>
  );
}
