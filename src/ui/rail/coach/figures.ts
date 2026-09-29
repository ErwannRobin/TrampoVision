import { JUMP_PHASES, type JumpCycle, type JumpPhase } from '../../../analysis/jumpCycles';
import { JOINT_STATE_NAMES } from '../../../analysis/stabilize';
import type { AnalysisResult } from '../../../analysis/types';
import type { SkillAnalysis } from '../../../skills/analyzeSkills';
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

export const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const PHASE_TEXT: Record<JumpPhase, string> = {
  unknown: 'Unknown',
  ground: 'On the bed',
  takeoff: 'Takeoff',
  ascent: 'Ascent',
  apex: 'Apex',
  descent: 'Descent',
  landing: 'Landing',
};

const PHASE_GLYPH: Partial<Record<JumpPhase, Glyph>> = {
  takeoff: 'up',
  ascent: 'lift',
  apex: 'gold',
  descent: 'drop',
  landing: 'down',
};

const heightWord = (reference: AnalysisResult['meta']['heightReference']) =>
  reference === 'bed' ? 'above bed' : 'above lowest point';

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
    label: 'Jump phase',
    figures: [{ value: PHASE_TEXT[phase] }, ...(cycle >= 0 ? [{ value: `Jump ${cycle + 1}`, muted: true }] : [])],
  };
  const glyph = PHASE_GLYPH[phase];
  if (glyph) phaseRow.glyph = glyph;

  const displacement = row(
    'x',
    meta.calibrated ? 'Displacement from bed center' : 'Displacement from start',
    [fig(signed(result.x[i], 2), 'm'), ...(meta.calibrated ? [fig(signed(result.xNorm[i] * 100, 0), '%', true)] : [])],
    `Along the on-screen horizontal, + is right in the image.${
      meta.calibrated ? ' The percentage is of the half-size of the bed.' : ''
    }`,
  );

  return {
    inJump,
    blocks: [
      [
        phaseRow,
        row('position', 'Body position', fig(inside(sentence(POSITIONS[fr.position[i]])))),
        row('hip', 'Hip angle', fig(inside(fmt(fr.hipAngle[i], 0)), '°')),
        row('knee', 'Knee angle', fig(inside(fmt(fr.kneeAngle[i], 0)), '°')),
        row('turns-now', 'Rotation so far', fig(inside(fmt(jumps.turnsSinceTakeoff[i], 2)), 'turns')),
        row('turns-jump', 'Rotation, whole jump', fig(fmt(jump?.features.rotation.turns, 2), 'turns')),
      ],
      [
        row('com', 'Center of mass', fig(com, 'px')),
        row('height', `Height ${heightWord(meta.heightReference)}`, fig(fmt(result.height[i], 2), 'm')),
        row('vy', 'Vertical velocity', fig(signed(result.vy[i], 2), 'm/s')),
        displacement,
      ],
      [
        row(
          'trunk',
          'Body angle',
          fig(fmt(result.trunkAngle[i], 1), '°'),
          'Trunk angle from vertical-up, wrapped to ±180°, + is clockwise.',
        ),
        row(
          'orientation',
          'Orientation (continuous)',
          fig(fmt(result.orientation[i], 1), '°'),
          'The same angle made continuous: it keeps counting past 360°.',
        ),
        row('count', 'Rotation count', [
          fig(fmt(jumps.turnsSinceTakeoff[i], 2), 'turns'),
          fig(String(jumps.completedRotations[i]), 'done', true),
        ]),
        row('omega', 'Angular velocity', fig(fmt(result.angularVelocity[i], 0), '°/s')),
      ],
      [
        row('confidence', 'Pose confidence', fig(fmt(result.confidence[i] * 100, 0), '%')),
        row(
          'joints',
          'Joints this frame',
          [
            fig(String(measured), 'measured'),
            fig(String(interpolated), 'interpolated'),
            fig(String(corrected), 'corrected'),
            fig(String(missing), 'missing'),
          ],
          'Corrected means a glitch was replaced.',
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
  const { timing: t, trajectory: tr, orientation: o, shape: s, rotation: r, facing, quality } = feat;

  const trajectory = [
    row('max-height', `Max height ${heightWord(meta.heightReference)}`, fig(fmt(tr.maxHeightM, 2), 'm')),
    row('rise', 'Height gained', [
      fig(fmt(tr.riseM, 2), 'm'),
      ...(tr.riseBodyLengths !== null ? [fig(fmt(tr.riseBodyLengths, 2), 'body lengths', true)] : []),
    ]),
    row(
      'drift',
      'Horizontal displacement',
      fig(signed(tr.horizontalDisplacementM, 2), 'm'),
      'Landing minus takeoff position, + is right in the image.',
    ),
  ];
  if (meta.calibrated)
    trajectory.push(
      row(
        'bed-takeoff',
        'Bed position at takeoff',
        fig(signed(tr.takeoffXBed, 2)),
        'Across the bed: ±1 is the edge, + is right in the image.',
      ),
      row('bed-apex', 'Bed position at apex', fig(signed(tr.apexXBed, 2))),
      row('bed-landing', 'Bed position at landing', fig(signed(tr.landingXBed, 2))),
    );

  const facingWord = facing.sign === 0 ? 'Undetermined' : facing.sign > 0 ? 'Right' : 'Left';

  return [
    {
      title: 'Timing',
      rows: [
        row('flight', 'Flight time', fig(fmt(t.flightTimeS, 2), 's')),
        row('to-apex', 'Time to apex', fig(fmt(t.timeToApexS, 2), 's')),
      ],
    },
    { title: 'Trajectory', rows: trajectory },
    {
      title: 'Rotation',
      rows: [
        row('rotation', 'Rotation', [
          fig(signed(r.totalDeg, 0), '°'),
          ...(r.totalDeg !== null ? [fig(r.direction, undefined, true)] : []),
        ]),
        row('peak-omega', 'Peak angular velocity', fig(fmt(o.peakAngularVelocityDps, 0), '°/s')),
        row('apex-orientation', 'Orientation at apex', fig(fmt(o.apexDeg, 0), '°')),
      ],
    },
    {
      title: 'Shape',
      rows: [
        row('hip', 'Hip angle', [
          { value: deg(s.hipAngle.min), unit: 'min' },
          { value: deg(s.hipAngle.atPeak), unit: 'at peak' },
        ]),
        row('knee', 'Knee angle', [
          { value: deg(s.kneeAngle.min), unit: 'min' },
          { value: deg(s.kneeAngle.atPeak), unit: 'at peak' },
        ]),
        row('knee-torso', 'Knees to torso', fig(fmt(s.kneeTorsoDistance.atPeak, 2), 'trunk lengths')),
        row('compactness', 'Compactness', fig(fmt(s.compactness.atPeak, 2))),
        row(
          'legs',
          'Leg separation',
          fig(fmt(s.legSeparation.atPeak, 2)),
          'Ankle distance / leg length. Barely visible from the side.',
        ),
        row(
          'axis',
          'Shoulder / hip axis',
          fig(fmt(s.shoulderHipAxis.atPeak, 0), '°'),
          'Angle between the shoulder line and the hip line. Not reliable in a side view.',
        ),
      ],
    },
    {
      title: 'Quality',
      rows: [
        row('rotation-confidence', 'Rotation confidence', fig(pct(r.confidence))),
        row('facing', 'Facing', [{ value: facingWord }, fig(pct(facing.confidence), undefined, true)]),
        row('pose-quality', 'Pose quality in flight', fig(pct(quality.pose))),
      ],
    },
  ];
}

/** Columns of the table of all jumps; `cells` of a `JumpTableRow` follow this order. */
export const JUMP_COLUMNS: { label: string; unit?: string; title: string }[] = [
  { label: 'Flight', unit: 's', title: 'Time in the air' },
  { label: 'To apex', unit: 's', title: 'Time from takeoff to apex' },
  { label: 'Max height', unit: 'm', title: 'Highest point of the center of mass' },
  { label: 'Takeoff vy', unit: 'm/s', title: 'Vertical speed at takeoff' },
  { label: 'Δx', unit: 'm', title: 'Horizontal displacement: landing minus takeoff position' },
  { label: 'Turns', title: 'Body rotation in the air, in turns' },
  { label: 'Done', title: 'Whole somersaults completed' },
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
    row('scale', 'Scale', [
      fig(fmt(meta.pixelsPerMeter, 0), 'px/m'),
      fig(meta.scaleSource === 'trampoline' ? 'from the bed' : 'from athlete height', undefined, true),
    ]),
  ];
  if (meta.calibrated)
    rows.push(
      row(
        'scales',
        'Bed vs. athlete scale',
        fig(`${fmt(meta.trampolinePixelsPerMeter, 0)} vs ${fmt(meta.athletePixelsPerMeter, 0)}`, 'px/m'),
      ),
    );
  rows.push(
    row(
      'free-fall',
      'Free-fall check',
      fig(fmt(meanGravity, 2), 'm/s²'),
      'Acceleration fitted to the middle of each flight. It should be 9.81 m/s².',
    ),
    row('valid', 'Frames with a center of mass', fig(fmt(summary.validFraction * 100, 0), '%')),
    row('glitches', 'Glitches removed', [
      fig(String(stats.spikesRejected), 'joint samples'),
      fig(String(stats.jumpFrames), 'frames'),
    ]),
    row('filled', 'Joint samples filled in', fig(fmt(((stats.interpolated + stats.corrected) / total) * 100, 1), '%')),
    row('missing', 'Joint samples missing', fig(fmt((stats.missing / total) * 100, 1), '%')),
    row('net-rotation', 'Net rotation of the clip', [
      fig(signed(summary.totalRotationDeg, 0), '°'),
      fig(fmt(summary.totalRotationDeg / 360, 2), 'turns', true),
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
    ['Elbow', j.leftElbow, j.rightElbow],
    ['Shoulder', j.leftShoulder, j.rightShoulder],
    ['Hip', j.leftHip, j.rightHip],
    ['Knee', j.leftKnee, j.rightKnee],
  ];
  return pairs.map(([name, left, right]) => ({ name, left: deg(left[i], 1), right: deg(right[i], 1) }));
}
