import { JUMP_PHASES, riseFromFlightTime, type JumpCycle, type JumpPhase } from '../../../analysis/jumpCycles';
import { JOINT_STATE_NAMES } from '../../../analysis/stabilize';
import type { AnalysisResult } from '../../../analysis/types';
import type { SkillAnalysis } from '../../../skills/analyzeSkills';
import { lazyText, t } from '../../../i18n/core';
import { POSITIONS, type JumpFeatures, type JumpSkillResult } from '../../../skills/types';
import { DASH, fmt, pct, signed } from '../../format';

/**
 * The numbers of the coach's lists as plain rows: a label, an optional hint, and one or more readings. Nothing here
 * measures anything; it reads the analysis and words it. Keeping it apart from the components makes the wording testable.
 */

/** One reading: the figure, the unit or caption after it, and whether it is a side note. */
export interface Figure {
  value: string;
  unit?: string;
  muted?: boolean;
}

/** The marks the timeline uses, so a phase reads the same in the list. */
export type Glyph = 'lift' | 'drop' | 'gold' | 'up' | 'down';

export interface FigureRow {
  key: string;
  label: string;
  /** What the number means, when the label alone does not say. */
  hint?: string;
  glyph?: Glyph;
  figures: Figure[];
}

export interface FigureGroup {
  title: string;
  rows: FigureRow[];
}

/** A reading with its unit. A missing value is a bare en dash; degrees and percents stick to the figure. */
export function fig(value: string, unit?: string, muted = false): Figure {
  const f: Figure = { value };
  if (unit && value !== DASH) {
    if (unit === '°' || unit === '%') f.value += unit;
    else f.unit = unit;
  }
  if (muted) f.muted = true;
  return f;
}

export function row(key: string, label: string, figures: Figure | Figure[], hint?: string): FigureRow {
  const r: FigureRow = { key, label, figures: Array.isArray(figures) ? figures : [figures] };
  if (hint) r.hint = hint;
  return r;
}

/** Degrees with the sign of the unit, or an en dash. */
export function deg(v: number | null | undefined, digits = 0): string {
  const text = fmt(v, digits);
  return text === DASH ? text : `${text}°`;
}

/** What each phase of a jump is called, in the language in use. */
export const PHASE_TEXT: Record<JumpPhase, string> = lazyText({
  unknown: 'phase.unknown',
  ground: 'phase.ground',
  takeoff: 'phase.takeoff',
  ascent: 'phase.ascent',
  apex: 'phase.apex',
  descent: 'phase.descent',
  landing: 'phase.landing',
});

const PHASE_GLYPH: Partial<Record<JumpPhase, Glyph>> = {
  takeoff: 'up',
  ascent: 'lift',
  apex: 'gold',
  descent: 'drop',
  landing: 'down',
};

const heightWord = (reference: AnalysisResult['meta']['heightReference']) =>
  reference === 'bed' ? t('row.aboveBed') : t('row.aboveLowest');

export interface FrameFigures {
  /** The playhead is inside the selected jump: the shape and rotation rows only mean something there. */
  inJump: boolean;
  /** Four blocks of rows: the jump, the motion, the rotation, the quality of the pose. */
  blocks: FigureRow[][];
}

/** Everything the analysis knows about one sample (the frame under the playhead). */
export function frameFigures(result: AnalysisResult, skills: SkillAnalysis, selected: number, i: number): FrameFigures {
  const { meta, jumps } = result;
  const jump: JumpSkillResult | undefined = skills.jumps[Math.min(selected, skills.jumps.length - 1)];
  const cycle = jumps.cycleIndex[i];
  const inJump = !!jump && cycle === jump.cycle.index;
  const fr = skills.frames;
  const phase = JUMP_PHASES[jumps.phase[i]];
  const counts = JOINT_STATE_NAMES.map((_, s) => result.jointState.reduce((n, st) => n + (st[i] === s ? 1 : 0), 0));
  const [missing, measured, interpolated, corrected] = counts;
  const inside = (value: string) => (inJump ? value : DASH);
  const com =
    Number.isFinite(result.comX[i]) && Number.isFinite(result.comY[i])
      ? `${fmt(result.comX[i], 0)}, ${fmt(result.comY[i], 0)}`
      : DASH;

  const phaseRow: FigureRow = {
    key: 'phase',
    label: t('row.phase'),
    figures: [
      { value: PHASE_TEXT[phase] },
      ...(cycle >= 0 ? [{ value: t('row.jumpNumber', { n: cycle + 1 }), muted: true }] : []),
    ],
  };
  const glyph = PHASE_GLYPH[phase];
  if (glyph) phaseRow.glyph = glyph;

  const displacement = row(
    'x',
    meta.calibrated ? t('row.displacementBed') : t('row.displacementStart'),
    [fig(signed(result.x[i], 2), 'm'), ...(meta.calibrated ? [fig(signed(result.xNorm[i] * 100, 0), '%', true)] : [])],
    t(meta.calibrated ? 'row.displacementHintBed' : 'row.displacementHint'),
  );

  return {
    inJump,
    blocks: [
      [
        phaseRow,
        row('position', t('row.bodyPosition'), fig(inside(t(`pos.${POSITIONS[fr.position[i]]}`)))),
        row('hip', t('row.hip'), fig(inside(fmt(fr.hipAngle[i], 0)), '°')),
        row('knee', t('row.knee'), fig(inside(fmt(fr.kneeAngle[i], 0)), '°')),
        row('turns-now', t('row.turnsNow'), fig(inside(fmt(jumps.turnsSinceTakeoff[i], 2)), t('u.turns'))),
        row('turns-jump', t('row.turnsJump'), fig(fmt(jump?.features.rotation.turns, 2), t('u.turns'))),
      ],
      [
        row('com', t('row.com'), fig(com, 'px')),
        row(
          'height',
          t('row.height', { reference: heightWord(meta.heightReference) }),
          fig(fmt(result.height[i], 2), 'm'),
        ),
        row('vy', t('row.vy'), fig(signed(result.vy[i], 2), 'm/s')),
        displacement,
      ],
      [
        row('trunk', t('row.trunk'), fig(fmt(result.trunkAngle[i], 1), '°'), t('row.trunkHint')),
        row('orientation', t('row.orientation'), fig(fmt(result.orientation[i], 1), '°'), t('row.orientationHint')),
        row('count', t('row.count'), [
          fig(fmt(jumps.turnsSinceTakeoff[i], 2), t('u.turns')),
          fig(String(jumps.completedRotations[i]), t('u.done'), true),
        ]),
        row('omega', t('row.omega'), fig(fmt(result.angularVelocity[i], 0), '°/s')),
      ],
      [
        row('confidence', t('row.confidence'), fig(fmt(result.confidence[i] * 100, 0), '%')),
        row(
          'joints',
          t('row.joints'),
          [
            fig(String(measured), t('u.measured')),
            fig(String(interpolated), t('u.interpolated')),
            fig(String(corrected), t('u.corrected')),
            fig(String(missing), t('u.missing')),
          ],
          t('row.jointsHint'),
        ),
      ],
    ],
  };
}

/** Every key measurement of one jump, grouped by what it describes. */
export function jumpFigures(
  feat: JumpFeatures,
  meta: Pick<AnalysisResult['meta'], 'calibrated' | 'heightReference'>,
): FigureGroup[] {
  const { timing: tm, trajectory: tr, orientation: o, shape: s, rotation: r, facing, quality } = feat;

  const trajectory = [
    row(
      'max-height',
      t('row.maxHeight', { reference: heightWord(meta.heightReference) }),
      fig(fmt(tr.maxHeightM, 2), 'm'),
    ),
    row('rise', t('row.rise'), [
      fig(fmt(tr.riseM, 2), 'm'),
      ...(tr.riseBodyLengths !== null ? [fig(fmt(tr.riseBodyLengths, 2), t('u.bodyLengths'), true)] : []),
    ]),
    row('air-rise', t('row.airRise'), fig(fmt(riseFromFlightTime(tm.flightTimeS), 2), 'm'), t('row.airRiseHint')),
    row('drift', t('row.drift'), fig(signed(tr.horizontalDisplacementM, 2), 'm'), t('row.driftHint')),
  ];
  if (meta.calibrated)
    trajectory.push(
      row('bed-takeoff', t('row.bedTakeoff'), fig(signed(tr.takeoffXBed, 2)), t('row.bedTakeoffHint')),
      row('bed-apex', t('row.bedApex'), fig(signed(tr.apexXBed, 2))),
      row('bed-landing', t('row.bedLanding'), fig(signed(tr.landingXBed, 2))),
    );

  const facingWord = t(facing.sign === 0 ? 'facing.none' : facing.sign > 0 ? 'facing.right' : 'facing.left');

  return [
    {
      title: t('group.timing'),
      rows: [
        row('flight', t('row.flight'), fig(fmt(tm.flightTimeS, 2), 's')),
        row('to-apex', t('row.toApex'), fig(fmt(tm.timeToApexS, 2), 's')),
      ],
    },
    { title: t('group.trajectory'), rows: trajectory },
    {
      title: t('group.rotation'),
      rows: [
        row('rotation', t('row.rotation'), [
          fig(signed(r.totalDeg, 0), '°'),
          ...(r.totalDeg !== null ? [fig(t(`turn.${r.direction}`), undefined, true)] : []),
        ]),
        row('peak-omega', t('row.peakOmega'), fig(fmt(o.peakAngularVelocityDps, 0), '°/s')),
        row('apex-orientation', t('row.apexOrientation'), fig(fmt(o.apexDeg, 0), '°')),
      ],
    },
    {
      title: t('group.shape'),
      rows: [
        row('hip', t('row.hip'), [
          { value: deg(s.hipAngle.min), unit: t('u.min') },
          { value: deg(s.hipAngle.atPeak), unit: t('u.atPeak') },
        ]),
        row('knee', t('row.knee'), [
          { value: deg(s.kneeAngle.min), unit: t('u.min') },
          { value: deg(s.kneeAngle.atPeak), unit: t('u.atPeak') },
        ]),
        row('knee-torso', t('row.kneeTorso'), fig(fmt(s.kneeTorsoDistance.atPeak, 2), t('u.trunkLengths'))),
        row('compactness', t('row.compactness'), fig(fmt(s.compactness.atPeak, 2))),
        row('legs', t('row.legs'), fig(fmt(s.legSeparation.atPeak, 2)), t('row.legsHint')),
        row('axis', t('row.axis'), fig(fmt(s.shoulderHipAxis.atPeak, 0), '°'), t('row.axisHint')),
      ],
    },
    {
      title: t('group.quality'),
      rows: [
        row('rotation-confidence', t('row.rotationConfidence'), fig(pct(r.confidence))),
        row('facing', t('row.facing'), [{ value: facingWord }, fig(pct(facing.confidence), undefined, true)]),
        row('pose-quality', t('row.poseQuality'), fig(pct(quality.pose))),
      ],
    },
  ];
}

/** Columns of the table of all jumps; `cells` of a `JumpTableRow` follow this order. */
export const jumpColumns = (): { label: string; unit?: string; title: string }[] => [
  { label: t('col.flight'), unit: 's', title: t('col.flightTitle') },
  { label: t('col.toApex'), unit: 's', title: t('col.toApexTitle') },
  { label: t('col.maxHeight'), unit: 'm', title: t('col.maxHeightTitle') },
  { label: t('col.takeoffVy'), unit: 'm/s', title: t('col.takeoffVyTitle') },
  { label: t('col.dx'), unit: 'm', title: t('col.dxTitle') },
  { label: t('col.turns'), title: t('col.turnsTitle') },
  { label: t('col.done'), title: t('col.doneTitle') },
];

export interface JumpTableRow {
  index: number;
  number: number;
  /** Both takeoff and landing were seen. */
  complete: boolean;
  cells: string[];
}

export function jumpTable(cycles: JumpCycle[]): JumpTableRow[] {
  return cycles.map((c) => ({
    index: c.index,
    number: c.index + 1,
    complete: c.complete,
    cells: [
      fmt(c.flightTimeS, 2),
      fmt(c.timeToApexS, 2),
      fmt(c.apexHeightM, 2),
      fmt(c.takeoffVyMps, 1),
      signed(c.horizontalDisplacementM, 2),
      fmt(c.turns, 2),
      c.completedRotations === null ? DASH : String(c.completedRotations),
    ],
  }));
}

/** How far the analysis can be trusted: scale, gaps, glitches. */
export function dataQualityRows(result: AnalysisResult): FigureRow[] {
  const { meta, jumps, summary, stabilizeStats: stats } = result;
  const total = Math.max(1, stats.measured + stats.interpolated + stats.corrected + stats.missing);
  const gravity = jumps.cycles
    .map((c) => c.impliedGravityMps2)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const meanGravity = gravity.length ? gravity.reduce((s, v) => s + v, 0) / gravity.length : null;

  const rows = [
    row('scale', t('row.scale'), [
      fig(fmt(meta.pixelsPerMeter, 0), 'px/m'),
      fig(t(meta.scaleSource === 'trampoline' ? 'row.scaleBed' : 'row.scaleAthlete'), undefined, true),
    ]),
  ];
  if (meta.calibrated)
    rows.push(
      row(
        'scales',
        t('row.scales'),
        fig(`${fmt(meta.trampolinePixelsPerMeter, 0)} vs ${fmt(meta.athletePixelsPerMeter, 0)}`, 'px/m'),
      ),
    );
  rows.push(
    row('free-fall', t('row.freeFall'), fig(fmt(meanGravity, 2), 'm/s²'), t('row.freeFallHint')),
    row('valid', t('row.valid'), fig(fmt(summary.validFraction * 100, 0), '%')),
    row('glitches', t('row.glitches'), [
      fig(String(stats.spikesRejected), t('u.jointSamples')),
      fig(String(stats.jumpFrames), t('u.frames')),
    ]),
    row('filled', t('row.filled'), fig(fmt(((stats.interpolated + stats.corrected) / total) * 100, 1), '%')),
    row('missing', t('row.missing'), fig(fmt((stats.missing / total) * 100, 1), '%')),
    row('net-rotation', t('row.netRotation'), [
      fig(signed(summary.totalRotationDeg, 0), '°'),
      fig(fmt(summary.totalRotationDeg / 360, 2), t('u.turns'), true),
    ]),
  );
  return rows;
}

export interface JointAngleRow {
  name: string;
  left: string;
  right: string;
}

/** The elbow, shoulder, hip and knee angles of both sides at one sample. */
export function jointAngleRows(result: AnalysisResult, i: number): JointAngleRow[] {
  const j = result.joints;
  const pairs: [string, Float64Array, Float64Array][] = [
    [t('joint.elbow'), j.leftElbow, j.rightElbow],
    [t('joint.shoulder'), j.leftShoulder, j.rightShoulder],
    [t('joint.hip'), j.leftHip, j.rightHip],
    [t('joint.knee'), j.leftKnee, j.rightKnee],
  ];
  return pairs.map(([name, left, right]) => ({ name, left: deg(left[i], 1), right: deg(right[i], 1) }));
}
