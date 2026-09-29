import type { Reference } from '../skills/temporal/prototypes';
import { buildSignature } from '../skills/temporal/signature';
import { elementById } from '../skills/fig/elements';
import type { JumpRecord } from './types';

/**
 * The labelled jumps as reference examples for the temporal classifier. The signature is rebuilt from the numbers stored in the
 * record (sequence and twist curve), so nothing else is needed and it works on a dataset file imported from another computer.
 * Records without a figure, without a sequence, or with an element that is not in the table are skipped.
 */
export function referencesFromRecords(records: readonly JumpRecord[]): Reference[] {
  const out: Reference[] = [];
  for (const r of records) {
    if (!r.figure || !r.sequence || !elementById(r.figure.elementId)) continue;
    const curve = r.twist?.sequence?.data.map((row) => row[1]) ?? null;
    const signature = buildSignature(
      r.sequence,
      r.twist && curve ? { estimate: r.twist.estimate, trajectory: curve } : null,
    );
    if (!signature) continue;
    out.push({
      id: `example:${r.id}`,
      elementId: r.figure.elementId,
      kind: 'example',
      source: { videoId: r.videoId, apexS: r.timestamps.apexS },
      signature,
    });
  }
  return out;
}

/** How many labelled examples each element has. */
export function exampleCounts(records: readonly JumpRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) if (r.figure) counts.set(r.figure.elementId, (counts.get(r.figure.elementId) ?? 0) + 1);
  return counts;
}
