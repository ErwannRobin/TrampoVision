import type { SkillAnalysis } from './analyzeSkills';
import type { CheckStatus, ElementCandidate, FailureKind, SkillPrediction } from './types';

/**
 * The classification explained: what was predicted, how sure, the movement in the four questions, the evidence as check
 * marks and the alternatives. Pure formatting of what the classifier returned; it decides nothing.
 */

const pct = (v: number) => `${Math.round(Math.min(Math.max(v, 0), 1) * 100)}%`;
export const CHECK_MARK: Record<CheckStatus, string> = { match: '✓', weak: '~', mismatch: '✗', unmeasured: '?' };

export interface ClassificationDebug {
  predicted: string;
  named: boolean;
  confidence: number;
  /** "Back / 1 somersault / 1 twist / straight" */
  movement: string;
  /** The top candidate's checks in the order the classifier asks them. */
  evidence: { mark: string; status: CheckStatus; text: string }[];
  /** `posterior` is the confidence of the alternative (temporal classifier: blended and times the data quality; hierarchical: structural probability). */
  alternatives: { name: string; posterior: number; similarity: number | null }[];
  certainty: string | null;
  /** One line per trajectory: how far the jump is from the closest reference, in tolerances. */
  trajectory: { label: string; distance: number | null }[];
  similarity: number | null;
  /** Best guess when nothing reached the threshold. */
  closest: string | null;
  failure: string | null;
}

export function movementText(p: SkillPrediction): string {
  const m = p.movement;
  if (!m) return '–';
  const parts = [
    m.somersaults === 0 ? 'no somersault' : `${m.direction ?? 'front or back'}`,
    m.somersaults === 0 ? null : `${m.somersaults} somersault${m.somersaults > 1 ? 's' : ''}`,
    m.twists === 0 ? 'no twist' : `${m.twists} twist${m.twists === 1 ? '' : 's'}`,
    m.position,
  ];
  return parts.filter(Boolean).join(' / ');
}

function evidenceOf(c: ElementCandidate) {
  return c.checks.map((k) => ({
    mark: CHECK_MARK[k.status],
    status: k.status,
    text:
      k.status === 'unmeasured'
        ? `${k.criterion}: not measured (expected ${k.expected})`
        : `${k.criterion}: ${k.observed}, ${k.status === 'match' ? 'expected' : 'needs'} ${k.expected}`,
  }));
}

export function describeClassification(p: SkillPrediction): ClassificationDebug | null {
  const cands = p.candidates;
  if (!cands || cands.length === 0) return null;
  const named = p.skill !== 'unclassified';
  const top = cands[0];
  return {
    predicted: named ? p.label : 'Unclassified',
    named,
    confidence: p.confidence,
    movement: named ? movementText(p) : '–',
    evidence: evidenceOf(top),
    alternatives: cands
      .slice(named ? 1 : 0, named ? 4 : 3)
      .map((c) => ({ name: c.name, posterior: c.score ?? c.posterior, similarity: c.similarity ?? null })),
    certainty: p.certainty ?? null,
    similarity: p.comparison?.similarity ?? null,
    trajectory: (p.comparison?.channels ?? []).map((c) => ({ label: c.label, distance: c.distance })),
    closest: named ? null : top.name,
    failure: p.failure?.message ?? null,
  };
}

/** The text form of `describeClassification`, for logs, the console and bug reports. */
export function formatClassificationDebug(p: SkillPrediction): string {
  const d = describeClassification(p);
  if (!d) return `Predicted:\n${p.label}\n\n${p.summary}`;
  const lines = [
    `Predicted:`,
    d.predicted,
    '',
    `Confidence:`,
    `${pct(d.confidence)}${d.certainty === 'tentative' ? ' (tentative guess)' : ''}`,
    '',
  ];
  if (d.named) lines.push('Movement:', d.movement, '');
  else if (d.closest) lines.push('Closest element:', d.closest, '');
  lines.push('Evidence:', ...d.evidence.map((e) => `${e.mark} ${e.text}`), '');
  if (d.trajectory.length)
    lines.push(
      `Trajectory match: ${d.similarity === null ? '–' : pct(d.similarity)}`,
      ...d.trajectory.map(
        (t) => `- ${t.label}: ${t.distance === null ? '–' : `${t.distance.toFixed(1)} tolerances off`}`,
      ),
      '',
    );
  if (d.failure) lines.push('Why not named:', d.failure, '');
  if (d.alternatives.length)
    lines.push(
      'Alternatives:',
      ...d.alternatives.map(
        (a) => `${a.name} — ${pct(a.posterior)}${a.similarity === null ? '' : ` (trajectory ${pct(a.similarity)})`}`,
      ),
    );
  if (p.evidence.length)
    lines.push('', 'Measurements:', ...p.evidence.map((e) => `- ${e.label}: ${e.text}${e.note ? ` (${e.note})` : ''}`));
  return lines.join('\n').trimEnd();
}

export interface UnclassifiedReport {
  jump: number;
  confidence: number;
  kind: FailureKind;
  criterion: string;
  message: string;
  closest: string | null;
  distances: string[];
  ifResolved: number | null;
  top: { name: string; posterior: number }[];
}

export interface UnclassifiedSummary {
  total: number;
  unclassified: number;
  /** Count of unclassified jumps per failure kind, most frequent first. */
  byKind: { kind: FailureKind; count: number }[];
  jumps: UnclassifiedReport[];
}

/** Every jump of the analysis that was not named, with the criterion that stopped it. */
export function diagnoseUnclassified(skills: Pick<SkillAnalysis, 'jumps'>): UnclassifiedSummary {
  const jumps: UnclassifiedReport[] = [];
  for (const j of skills.jumps) {
    const p = j.prediction;
    if (p.skill !== 'unclassified' || !p.failure) continue;
    jumps.push({
      jump: j.cycle.index,
      confidence: p.confidence,
      kind: p.failure.kind,
      criterion: p.failure.criterion,
      message: p.failure.message,
      closest: p.failure.closest?.name ?? null,
      distances: p.failure.distances.map((d) => `${d.text} (fit ${pct(d.match)})`),
      ifResolved: p.failure.ifResolved,
      top: (p.candidates ?? []).slice(0, 3).map((c) => ({ name: c.name, posterior: c.posterior })),
    });
  }
  const counts = new Map<FailureKind, number>();
  for (const r of jumps) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  return {
    total: skills.jumps.length,
    unclassified: jumps.length,
    byKind: [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    jumps,
  };
}

export function formatUnclassified(s: UnclassifiedSummary): string {
  if (s.unclassified === 0) return `All ${s.total} jumps were named.`;
  const lines = [
    `${s.unclassified} of ${s.total} jumps unclassified: ${s.byKind.map((b) => `${b.kind} ×${b.count}`).join(', ')}`,
  ];
  for (const r of s.jumps) {
    lines.push(
      '',
      `Jump ${r.jump + 1}: ${r.kind} (criterion: ${r.criterion}), best confidence ${pct(r.confidence)}`,
      `  ${r.message}`,
      ...(r.closest ? [`  closest: ${r.closest}`] : []),
      ...r.distances.map((d) => `  - ${d}`),
      ...(r.ifResolved !== null ? [`  if ${r.criterion} were certain: ${pct(r.ifResolved)}`] : []),
      ...r.top.map((t, i) => `  ${i === 0 ? 'Likely' : 'Alternative'}: ${t.name} — ${pct(t.posterior)}`),
    );
  }
  return lines.join('\n');
}
