import { LANDMARK_COUNT } from '../pose/landmarks';
import { JOINT_NAMES, type AnalysisResult } from './types';

const r = (v: number, d = 3) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

export function toCsv(a: AnalysisResult): string {
  const head = [
    'sample', 'time_s', 'confidence', 'com_x_px', 'com_y_px', 'com_height_m', 'com_vy_mps',
    'trunk_angle_deg', 'body_line_angle_deg', 'rotation_deg', 'angular_velocity_dps', ...JOINT_NAMES.map((j) => `${j}_deg`),
  ];
  const rows = [head.join(',')];
  for (let i = 0; i < a.meta.count; i++) {
    const cells = [
      i, a.time[i], a.confidence[i], a.comX[i], a.comY[i], a.height[i], a.vy[i], a.trunkAngle[i], a.lineAngle[i],
      a.rotation[i], a.angularVelocity[i], ...JOINT_NAMES.map((j) => a.joints[j][i]),
    ].map((v) => (Number.isFinite(v) ? Number(v.toFixed(4)) : ''));
    rows.push(cells.join(','));
  }
  return rows.join('\n');
}

/** Full dump (including smoothed landmarks) – the natural input for a future temporal model. */
export function toJson(a: AnalysisResult): string {
  return JSON.stringify({
    meta: a.meta,
    summary: a.summary,
    landmarkOrder: `MediaPipe pose, ${LANDMARK_COUNT} points, pixel coordinates (y down)`,
    frames: Array.from({ length: a.meta.count }, (_, i) => ({
      t: r(a.time[i], 4),
      confidence: r(a.confidence[i]),
      com: [r(a.comX[i], 2), r(a.comY[i], 2)],
      heightM: r(a.height[i]),
      vyMps: r(a.vy[i]),
      trunkDeg: r(a.trunkAngle[i], 2),
      rotationDeg: r(a.rotation[i], 2),
      joints: Object.fromEntries(JOINT_NAMES.map((j) => [j, r(a.joints[j][i], 2)])),
      landmarks: a.landmarks[i]?.map((p) => [r(p.x, 2), r(p.y, 2), r(p.visibility, 2)]) ?? null,
    })),
  });
}

export function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
