import { formatDecimal, formatNumber, formatPercent, lower, t, tp } from '../i18n/core';
import type { SkillAnalysis } from './analyzeSkills';
import { positionWord } from './classifier';
import type { CheckStatus, ElementCandidate, FailureKind, SkillPrediction } from './types';

/**
 * The classification explained: what was predicted, how sure, the movement in the four questions, the evidence as check
 * marks and the alternatives. Pure formatting of what the classifier returned; it decides nothing.
 */

const pct = (v: number) => formatPercent(Math.min(Math.max(v, 0), 1));
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
    m.somersaults === 0
      ? t('label.noSomersault')
      : m.direction
        ? lower(t(`dir.${m.direction}`))
        : t('label.directionOrBoth'),
    m.somersaults === 0 ? null : tp('label.somersaults', m.somersaults, { n: formatDecimal(m.somersaults) }),
    m.twists === 0 ? t('label.noTwist') : tp('label.twists', m.twists, { n: formatDecimal(m.twists) }),
    positionWord(m.position),
  ];
  return parts.filter(Boolean).join(' / ');
}

function evidenceOf(c: ElementCandidate) {
  return c.checks.map((k) => ({
    mark: CHECK_MARK[k.status],
    status: k.status,
    text:
      k.status === 'unmeasured'
        ? t('debug.notMeasured', { criterion: k.criterion, expected: k.expected })
        : t(k.status === 'match' ? 'debug.observedMatch' : 'debug.observedNeeds', {
            criterion: k.criterion,
            observed: k.observed,
            expected: k.expected,
          }),
  }));
}

export function describeClassification(p: SkillPrediction): ClassificationDebug | null {
  const cands = p.candidates;
  if (!cands || cands.length === 0) return null;
  const named = p.skill !== 'unclassified';
  const top = cands[0];
  return {
    predicted: named ? p.label : t('skill.unclassified'),
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
    t('debug.predicted'),
    d.predicted,
    '',
    t('debug.confidence'),
    `${pct(d.confidence)}${d.certainty === 'tentative' ? t('debug.tentative') : ''}`,
    '',
  ];
  if (d.named) lines.push(t('debug.movement'), d.movement, '');
  else if (d.closest) lines.push(t('debug.closest'), d.closest, '');
  lines.push(t('debug.evidence'), ...d.evidence.map((e) => `${e.mark} ${e.text}`), '');
  if (d.trajectory.length)
    lines.push(
      t('debug.trajectory', { sim: d.similarity === null ? '–' : pct(d.similarity) }),
      ...d.trajectory.map(
        (c) => `- ${c.label}: ${c.distance === null ? '–' : t('ev.tolerances', { d: formatNumber(c.distance, 1) })}`,
      ),
      '',
    );
  if (d.failure) lines.push(t('debug.why'), d.failure, '');
  if (d.alternatives.length)
    lines.push(
      t('debug.alternatives'),
      ...d.alternatives.map((a) =>
        a.similarity === null
          ? t('debug.alternative', { name: a.name, conf: pct(a.posterior) })
          : t('debug.alternativeSim', { name: a.name, conf: pct(a.posterior), sim: pct(a.similarity) }),
      ),
    );
  if (p.evidence.length)
    lines.push(
      '',
      t('debug.measurements'),
      ...p.evidence.map((e) =>
        e.note
          ? t('debug.measurementNote', { label: e.label, text: e.text, note: e.note })
          : t('debug.measurement', { label: e.label, text: e.text }),
      ),
    );
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
    // Jumps the classifier could not name, and the ones it named only because it was asked to guess.
    if ((p.skill !== 'unclassified' && !p.guess?.closest) || !p.failure) continue;
    jumps.push({
      jump: j.cycle.index,
      confidence: p.confidence,
      kind: p.failure.kind,
      criterion: p.failure.criterion,
      message: p.failure.message,
      closest: p.failure.closest?.name ?? null,
      distances: p.failure.distances.map((d) => t('debug.fit', { text: d.text, fit: pct(d.match) })),
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
