import { JOINT_NAMES, type AnalysisResult } from './types';
import { JUMP_PHASES, type JumpCycle } from './jumpCycles';

const cell = (v: number | string | null) =>
  typeof v === 'string' ? v : v !== null && Number.isFinite(v) ? Number(v.toFixed(4)) : '';

/** One row per frame: the main time series. (The complete store, with every joint, is the JSON export.) */
export function toCsv(a: AnalysisResult): string {
  const head = [
    'sample', 'time_s', 'confidence', 'phase', 'jump', 'com_x_px', 'com_y_px', 'com_x_m', 'com_x_norm', 'com_height_m',
    'com_vy_mps', 'orientation_deg', 'trunk_angle_deg', 'body_line_angle_deg', 'rotation_deg', 'turns_since_takeoff',
    'completed_rotations', 'angular_velocity_dps', ...JOINT_NAMES.map((j) => `${j}_deg`),
  ];
  const rows = [head.join(',')];
  for (let i = 0; i < a.meta.count; i++) {
    const cycle = a.jumps.cycleIndex[i];
    const cells = [
      i, a.time[i], a.confidence[i], JUMP_PHASES[a.jumps.phase[i]], cycle >= 0 ? cycle + 1 : null, a.comX[i], a.comY[i],
      a.x[i], a.xNorm[i], a.height[i], a.vy[i], a.orientation[i], a.trunkAngle[i], a.lineAngle[i], a.rotation[i],
      a.jumps.turnsSinceTakeoff[i], a.jumps.completedRotations[i], a.angularVelocity[i], ...JOINT_NAMES.map((j) => a.joints[j][i]),
    ].map((v) => cell(v));
    rows.push(cells.join(','));
  }
  return rows.join('\n');
}

const JUMP_COLUMNS: [string, (c: JumpCycle) => number | null][] = [
  ['takeoff_s', (c) => c.takeoffTimeS],
  ['apex_s', (c) => c.apexTimeS],
  ['landing_s', (c) => c.landingTimeS],
  ['flight_time_s', (c) => c.flightTimeS],
  ['time_to_apex_s', (c) => c.timeToApexS],
  ['apex_height_m', (c) => c.apexHeightM],
  ['rise_m', (c) => c.riseM],
  ['takeoff_vy_mps', (c) => c.takeoffVyMps],
  ['landing_vy_mps', (c) => c.landingVyMps],
  ['ballistic_takeoff_vy_mps', (c) => c.ballisticTakeoffVyMps],
  ['x_takeoff_m', (c) => c.xTakeoffM],
  ['x_landing_m', (c) => c.xLandingM],
  ['horizontal_displacement_m', (c) => c.horizontalDisplacementM],
  ['rotation_deg', (c) => c.rotationDeg],
  ['turns', (c) => c.turns],
  ['quarter_turns', (c) => c.quarterTurns],
  ['completed_rotations', (c) => c.completedRotations],
  ['implied_gravity_mps2', (c) => c.impliedGravityMps2],
];

/** One row per detected jump. */
export function toJumpsCsv(a: AnalysisResult): string {
  const rows = [['jump', 'complete', ...JUMP_COLUMNS.map(([name]) => name)].join(',')];
  for (const c of a.jumps.cycles) {
    rows.push([c.index + 1, c.complete ? 1 : 0, ...JUMP_COLUMNS.map(([, get]) => cell(get(c)))].join(','));
  }
  return rows.join('\n');
}

export function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
