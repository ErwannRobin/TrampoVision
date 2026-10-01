import { referencesFromRecords } from '../dataset/references';
import { mergeSkillConfig } from '../skills/config';
import { elementById, type FigElement } from '../skills/fig/elements';
import { classifyWithJev, type JevResult } from '../skills/jev/classify';
import type { JevClientOptions } from '../skills/jev/client';
import { inputOfRecord, type LabelledJump } from './replay';

/**
 * Jev against the current classifier on the same reviewed jumps. Both read the same stored measurements; the local one runs
 * unchanged, so any difference is Jev's. Offline: no video is involved, and only the measurements go to Jev.
 */

const PARTS = ['somersaults', 'twists', 'direction', 'position'] as const;
type Part = (typeof PARTS)[number];

interface Side {
  predicted: string | null;
  /** 1-based rank of the truth among the five best, or null. */
  rank: number | null;
  correct: boolean;
}

export interface CompareRow {
  id: string;
  videoId: string;
  truth: string;
  local: Side & { confidence: number };
  jev: Side & { confidence: number; status: JevResult['status'] };
  /** The element of the final answer (Jev when it answered, else local). */
  final: Side;
  latencyMs: number;
  inputTokens: number;
  result: JevResult;
}

const side = (predicted: string | null, ranked: string[], truth: string): Side => {
  const i = ranked.indexOf(truth);
  return { predicted, rank: i < 0 ? null : i + 1, correct: predicted === truth };
};

export interface CompareOptions {
  client: JevClientOptions | null;
  references: 'none' | 'leave-one-video-out';
  concurrency?: number;
  onRow?: (row: CompareRow) => void;
}

export async function runJevCompare(jumps: readonly LabelledJump[], o: CompareOptions): Promise<CompareRow[]> {
  const config = mergeSkillConfig();
  const labelled = jumps.filter((j): j is LabelledJump & { truth: string } => j.truth !== null);
  const examples =
    o.references === 'leave-one-video-out'
      ? referencesFromRecords(labelled.map((j) => ({ ...j.record, figure: { elementId: j.truth, labeledAt: '' } })))
      : [];
  const rows: CompareRow[] = new Array(labelled.length);
  let next = 0;
  const worker = async () => {
    for (let k = next++; k < labelled.length; k = next++) {
      const j = labelled[k];
      const refs = examples.filter((e) => e.source?.videoId !== j.videoId);
      const result = await classifyWithJev(inputOfRecord(j.record, config, refs), { client: o.client });
      const localTop = (result.local.candidates ?? []).slice(0, 5).map((c) => c.elementId);
      const jevTop = result.candidates.map((c) => c.elementId);
      const named = result.local.skill !== 'unclassified';
      rows[k] = {
        id: j.id,
        videoId: j.videoId,
        truth: j.truth,
        local: {
          ...side(named ? (result.local.elementId ?? null) : null, localTop, j.truth),
          confidence: result.local.confidence,
        },
        jev: {
          ...side(result.jevElementId, jevTop, j.truth),
          confidence: result.candidates[0]?.probability ?? 0,
          status: result.status,
        },
        final: side(result.final.elementId, result.final.source === 'jev' ? jevTop : localTop, j.truth),
        latencyMs: result.latencyMs,
        inputTokens: result.usage?.input_tokens ?? 0,
        result,
      };
      o.onRow?.(rows[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 4) }, worker));
  return rows;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ratio = (k: number, n: number) => `${pct(n ? k / n : 0)} (${k}/${n})`;

const partOf = (e: FigElement | undefined, p: Part): string | null =>
  !e
    ? null
    : p === 'somersaults'
      ? String(e.somersaults)
      : p === 'twists'
        ? String(e.twists)
        : p === 'direction'
          ? e.somersaults
            ? e.direction
            : 'none'
          : e.position;

export function formatCompare(rows: readonly CompareRow[]): string {
  const n = rows.length;
  if (!n) return 'No reviewed jump to compare.';
  const jevOk = rows.filter((r) => r.jev.status === 'ok');
  const out: string[] = [
    `== Jev against the current classifier: ${n} reviewed jumps, Jev answered ${jevOk.length} ==`,
    '',
  ];
  const line = (name: string, f: (r: CompareRow) => Side, set: readonly CompareRow[]) =>
    out.push(
      `${name.padEnd(18)} top-1 ${ratio(set.filter((r) => f(r).correct).length, set.length).padEnd(18)} top-3 ${ratio(set.filter((r) => (f(r).rank ?? 9) <= 3).length, set.length).padEnd(18)} top-5 ${ratio(set.filter((r) => f(r).rank !== null).length, set.length)}`,
    );
  out.push(`On the ${jevOk.length} jumps Jev answered:`);
  line('local (DTW)', (r) => r.local, jevOk);
  line('Jev', (r) => r.jev, jevOk);
  out.push(`On all ${n} jumps (final answer = Jev, else local):`);
  line('local (DTW)', (r) => r.local, rows);
  line('final', (r) => r.final, rows);

  out.push('', 'Which part is right (somersaults / twists / direction / position), on the jumps Jev answered:');
  for (const [name, get] of [
    ['local', (r: CompareRow) => r.local.predicted],
    ['Jev', (r: CompareRow) => r.jev.predicted],
  ] as const) {
    const cells = PARTS.map((p) => {
      const ok = jevOk.filter((r) => {
        const t = partOf(elementById(r.truth), p);
        const g = partOf(elementById(get(r) ?? ''), p);
        return g !== null && g === t;
      }).length;
      return `${p} ${ratio(ok, jevOk.length)}`;
    });
    out.push(`  ${name.padEnd(6)} ${cells.join('   ')}`);
  }

  const better = jevOk.filter((r) => r.jev.correct && !r.local.correct);
  const worse = jevOk.filter((r) => !r.jev.correct && r.local.correct);
  out.push(
    '',
    `Jev right and local wrong: ${better.length}   Jev wrong and local right: ${worse.length}   same answer: ${jevOk.filter((r) => r.jev.predicted === r.local.predicted).length}`,
  );
  for (const r of [...better, ...worse]) {
    out.push(
      `  ${r.id}  truth ${r.truth}  local ${r.local.predicted ?? '–'}  Jev ${r.jev.predicted ?? '–'} (${pct(r.jev.confidence)})`,
    );
  }

  const bins: [number, number][] = [
    [0, 0.5],
    [0.5, 0.8],
    [0.8, 1.0001],
  ];
  out.push('', 'Is the confidence honest? (share right by confidence)');
  for (const [name, f] of [
    ['local', (r: CompareRow) => r.local],
    ['Jev', (r: CompareRow) => r.jev],
  ] as const) {
    out.push(
      `  ${name.padEnd(6)} ${bins
        .map(([a, b]) => {
          const set = jevOk.filter((r) => f(r).confidence >= a && f(r).confidence < b);
          return `${Math.round(a * 100)}-${Math.min(100, Math.round(b * 100))}%: ${ratio(set.filter((r) => f(r).correct).length, set.length)}`;
        })
        .join('   ')}`,
    );
  }
  const ms = jevOk.map((r) => r.latencyMs).sort((a, b) => a - b);
  if (ms.length) {
    out.push(
      '',
      `Jev latency median ${ms[Math.floor(ms.length / 2)]} ms, max ${ms.at(-1)} ms; ${jevOk.reduce((s, r) => s + r.inputTokens, 0)} input tokens in all.`,
    );
  }
  const failed = rows.filter((r) => r.jev.status !== 'ok');
  if (failed.length)
    out.push(`Jev unavailable for ${failed.length}: ${[...new Set(failed.map((r) => r.result.error))].join('; ')}`);
  return out.join('\n');
}
