import { cell, FEATURE_COLUMNS, type FlatJump } from '../skills/export';
import { SEQUENCE_JOINTS } from '../skills/frameShape';
import { POSITIONS } from '../skills/types';
import { findFailures } from './failures';
import { agrees, computeMetrics, labelOf, predictionOf, PREDICTED_COLUMNS, type Metrics } from './metrics';
import { RECORD_SCHEMA, RECORD_VERSION, TRUTH_TEXT, type JumpRecord } from './types';

export const DATASET_SCHEMA = 'trampovision.jump-dataset';
export const DATASET_VERSION = 1;
export const EVALUATION_SCHEMA = 'trampovision.evaluation';
export const EVALUATION_VERSION = 1;

/** Named views of the sequence numbers, so a reader does not have to know the column order. They repeat the sequence and are dropped when a file is imported. */
export interface RecordViews {
  skeleton: { frame: string; joints: string[]; samples: number; u: number[]; data: number[][][] } | null;
  signals: {
    u: number[];
    timeS: number[];
    comTrajectory: { heightBodyLengths: number[]; xBodyLengths: number[]; xBed: number[]; heightM: number[]; xM: number[]; vyMps: number[] };
    bodyOrientation: { turnsSinceTakeoff: number[]; sin: number[]; cos: number[] };
    angularVelocityTurnsPerS: number[];
    jointAngles: { hipDeg: number[]; kneeDeg: number[]; shoulderHipAxisDeg: number[] };
    shape: { kneeToTorso: number[]; legSeparation: number[]; compactness: number[] };
    bodyPosition: string[];
    poseQuality: number[];
  } | null;
}

export function recordViews(r: JumpRecord): RecordViews {
  const seq = r.sequence;
  if (!seq) return { skeleton: null, signals: null };
  const col = (name: string) => {
    const k = seq.columns.indexOf(name);
    return seq.data.map((row) => row[k]);
  };
  const joints = SEQUENCE_JOINTS.map((j) => j.name);
  const x = joints.map((j) => col(`${j}_x`));
  const y = joints.map((j) => col(`${j}_y`));
  return {
    skeleton: {
      frame: seq.frame,
      joints,
      samples: seq.samples,
      u: col('u'),
      data: seq.data.map((_, s) => joints.map((__, j) => [x[j][s], y[j][s]])),
    },
    signals: {
      u: col('u'),
      timeS: col('time_s'),
      comTrajectory: {
        heightBodyLengths: col('com_h_body'),
        xBodyLengths: col('com_x_body'),
        xBed: col('com_x_bed'),
        heightM: col('com_h_m'),
        xM: col('com_x_m'),
        vyMps: col('com_vy_mps'),
      },
      bodyOrientation: { turnsSinceTakeoff: col('orient_turns'), sin: col('orient_sin'), cos: col('orient_cos') },
      angularVelocityTurnsPerS: col('angvel_turns_per_s'),
      jointAngles: { hipDeg: col('hip_angle_deg'), kneeDeg: col('knee_angle_deg'), shoulderHipAxisDeg: col('shoulder_hip_axis_deg') },
      shape: { kneeToTorso: col('knee_torso'), legSeparation: col('leg_separation'), compactness: col('compactness') },
      bodyPosition: col('position').map((p) => POSITIONS[p] ?? 'unknown'),
      poseQuality: col('quality'),
    },
  };
}

/** NaN and infinity become null; numbers are rounded to 5 decimals. */
const replacer = (_k: string, v: unknown) => (typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : null) : v);

export interface DatasetFile {
  schema: typeof DATASET_SCHEMA;
  version: number;
  exportedAt: string;
  count: number;
  records: (JumpRecord & { views: RecordViews })[];
}

export function toDatasetJson(records: JumpRecord[], now = new Date()): string {
  const file: DatasetFile = {
    schema: DATASET_SCHEMA,
    version: DATASET_VERSION,
    exportedAt: now.toISOString(),
    count: records.length,
    records: records.map((r) => ({ ...r, views: recordViews(r) })),
  };
  return JSON.stringify(file, replacer);
}

/** Reads a dataset file back into records. Throws a readable Error. The derived `views` are dropped; `null` in a sequence becomes NaN again. */
export function parseDataset(text: string): JumpRecord[] {
  let data: Partial<DatasetFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!data || data.schema !== DATASET_SCHEMA) throw new Error('This is not a TrampoVision dataset file.');
  if (typeof data.version !== 'number' || data.version > DATASET_VERSION) throw new Error(`Unsupported dataset version (${String(data.version)}); this app reads version ${DATASET_VERSION}.`);
  if (!Array.isArray(data.records)) throw new Error('The dataset has no records.');
  return data.records.map((raw, i) => {
    const r = raw as Partial<JumpRecord> & { views?: unknown };
    if (r.schema !== RECORD_SCHEMA || r.version !== RECORD_VERSION || typeof r.id !== 'string' || typeof r.videoId !== 'string' || !r.features || !r.prediction || !r.timestamps) {
      throw new Error(`Record ${i + 1} is not a valid jump record.`);
    }
    const { views: _views, ...rest } = r;
    void _views;
    const seq = rest.sequence ? { ...rest.sequence, data: rest.sequence.data.map((row) => row.map((v) => (v === null ? NaN : v))) } : null;
    return { ...(rest as JumpRecord), sequence: seq, twistTruth: rest.twistTruth ?? null, truth: rest.truth ?? null };
  });
}

// --- CSV ------------------------------------------------------------------------------------------------------------

type Col = [string, (r: JumpRecord) => number | string | boolean | null];

const flat = (r: JumpRecord): FlatJump => ({ index: r.jumpId - 1, features: r.features, prediction: r.prediction });

/** Per jump: ids, the label, the features and prediction flattened, whether the prediction was right, and the experimental twist. */
const DATASET_COLUMNS: Col[] = [
  ['video_id', (r) => r.videoId],
  ['jump_id', (r) => r.jumpId],
  ['file_name', (r) => r.source.fileName],
  ['truth', (r) => r.truth?.label ?? ''],
  ['predicted', (r) => predictionOf(r)],
  ['correct', (r) => {
    const t = labelOf(r);
    return t === null || t === 'unknown' ? '' : agrees(t, predictionOf(r));
  }],
  ...FEATURE_COLUMNS.filter(([name]) => name !== 'jump').map<Col>(([name, get]) => [name, (r) => get(flat(r))]),
  ['twist_available', (r) => r.twist?.estimate.available ?? false],
  ['twist_deg', (r) => r.twist?.estimate.totalDeg ?? null],
  ['twist_half_twists', (r) => r.twist?.estimate.halfTwists ?? null],
  ['twist_confidence', (r) => r.twist?.estimate.confidence ?? null],
  ['twist_reliable', (r) => r.twist?.estimate.reliable ?? null],
  ['twist_plane_axis_deg', (r) => r.twist?.estimate.cross.inPlaneAxisDeg ?? null],
  ['twist_truth_half_twists', (r) => r.twistTruth?.halfTwists ?? null],
  ['classifier', (r) => `${r.analysis.classifier.id} v${r.analysis.classifier.version}`],
  ['note', (r) => r.truth?.note ?? ''],
  ['labeled_at', (r) => r.truth?.labeledAt ?? ''],
];

export function toDatasetCsv(records: JumpRecord[]): string {
  const rows = [DATASET_COLUMNS.map(([name]) => name).join(',')];
  for (const r of records) rows.push(DATASET_COLUMNS.map(([, get]) => cell(get(r))).join(','));
  return rows.join('\n');
}

// --- Evaluation -----------------------------------------------------------------------------------------------------

export interface EvaluationReport {
  schema: typeof EVALUATION_SCHEMA;
  version: number;
  generatedAt: string;
  scope: { kind: 'all' | 'video'; videoId: string | null; videos: number };
  /** The classifier(s) and how many distinct threshold sets produced the predictions in scope: more than one means the predictions are not comparable. */
  classifiers: { id: string; version: string }[];
  distinctConfigs: number;
  metrics: Metrics;
  jumps: { id: string; videoId: string; jumpId: number; truth: string | null; predicted: string; confidence: number; correct: boolean | null }[];
  failures: string[];
}

export function buildEvaluationReport(records: JumpRecord[], scope: { kind: 'all' | 'video'; videoId?: string }, now = new Date()): EvaluationReport {
  const cls = new Map(records.map((r) => [`${r.analysis.classifier.id}@${r.analysis.classifier.version}`, r.analysis.classifier]));
  return {
    schema: EVALUATION_SCHEMA,
    version: EVALUATION_VERSION,
    generatedAt: now.toISOString(),
    scope: { kind: scope.kind, videoId: scope.videoId ?? null, videos: new Set(records.map((r) => r.videoId)).size },
    classifiers: [...cls.values()],
    distinctConfigs: new Set(records.map((r) => JSON.stringify(r.analysis.config))).size,
    metrics: computeMetrics(records),
    jumps: records.map((r) => {
      const t = labelOf(r);
      const p = predictionOf(r);
      return { id: r.id, videoId: r.videoId, jumpId: r.jumpId, truth: t, predicted: p, confidence: r.prediction.confidence, correct: t === null || t === 'unknown' ? null : agrees(t, p) };
    }),
    failures: findFailures(records).map((f) => f.record.id),
  };
}

export const toEvaluationJson = (report: EvaluationReport): string => JSON.stringify(report, replacer);

/**
 * One table: a row per true label. Columns: the number of samples, precision / recall / one-vs-rest accuracy, then the confusion
 * matrix (how many of that label were predicted as each column). Precision and accuracy belong to the class, so "unknown" has none.
 */
export function toEvaluationCsv(m: Metrics): string {
  const head = ['true_label', 'samples', 'predicted_as_this', 'correct', 'precision', 'recall', 'accuracy_one_vs_rest', ...PREDICTED_COLUMNS.map((c) => `pred_${c}`)];
  const rows = [head.join(',')];
  m.matrix.rows.forEach((label, i) => {
    const cls = m.perClass.find((c) => c.label === label);
    rows.push(
      [
        TRUTH_TEXT[label],
        m.samplesPerClass[label],
        cls?.predicted ?? '',
        cls?.correct ?? '',
        cls?.precision ?? '',
        cls?.recall ?? '',
        cls?.accuracyOneVsRest ?? '',
        ...m.matrix.counts[i],
      ]
        .map((v) => cell(v as number | string | null))
        .join(','),
    );
  });
  const o = m.overall;
  rows.push('');
  rows.push('overall_metric,value');
  const overall: [string, number | null][] = [
    ['jumps_evaluated', o.n],
    ['accuracy', o.accuracy],
    ['accuracy_ci95_low', o.ci95?.lo ?? null],
    ['accuracy_ci95_high', o.ci95?.hi ?? null],
    ['balanced_accuracy', o.balancedAccuracy],
    ['coverage_answered_share', o.coverage],
    ['accuracy_when_answered', o.accuracyWhenAnswered],
    ['confident_wrong_answers', o.confidentWrong],
    ['labeled_unknown', m.counts.unknown],
    ['unlabeled', m.counts.unlabeled],
  ];
  for (const [k, v] of overall) rows.push(`${k},${cell(v)}`);
  return rows.join('\n');
}


/** Every extracted feature of a record (and its twist) as name / text pairs, for reading on screen. */
export function flatRows(r: JumpRecord): [string, string][] {
  return DATASET_COLUMNS.filter(([name]) => !['video_id', 'jump_id', 'file_name', 'truth', 'predicted', 'correct', 'note', 'labeled_at', 'classifier'].includes(name)).map(([name, get]) => {
    const v = get(r);
    return [name, v === null || v === '' ? '–' : typeof v === 'number' ? String(Number(v.toFixed(3))) : String(v)];
  });
}
