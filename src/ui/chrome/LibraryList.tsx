import { t, tp } from '../../i18n';
import { inNeedOrder, percent, type LibraryClip } from '../../sync/library';
import { Badge, Button, Disclosure, type BadgeTone } from '../kit';

export interface LibraryListProps {
  clips: LibraryClip[];
  onOpen: (clip: LibraryClip) => void;
  /** Analyzes the clips nobody analyzed, one after the other. Without it there is no such button. */
  onAll?: () => void;
  busy: boolean;
}

/** How well the best analysis of a clip reads it: the Worker's score, with the same tones as the moderation page. */
function readBadge(clip: LibraryClip): { tone: BadgeTone; text: string } {
  if (!clip.analysis) return { tone: 'outline', text: t('library.todo') };
  const score = clip.analysis.score;
  return { tone: score >= 0.8 ? 'ok' : score >= 0.5 ? 'warn' : 'danger', text: percent(score) };
}

/**
 * The clips of the library on the first screen, the ones that need an analysis first. Opening one analyzes it when nobody did, and
 * the analysis goes back to the library on its own (src/sync/library.ts): that is what the list is for.
 */
export function LibraryList({ clips, onOpen, onAll, busy }: LibraryListProps) {
  if (clips.length === 0) return null;
  const todo = clips.filter((c) => !c.analysis).length;
  return (
    <Disclosure className="library" title={t('library.title')} meta={tp('library.count', clips.length, { todo })}>
      <p className="library__hint">{t('library.hint')}</p>
      {onAll && todo > 0 && (
        <Button variant="secondary" className="library__all" disabled={busy} onClick={onAll}>
          {tp('library.all', todo)}
        </Button>
      )}
      <ul className="library__list">
        {inNeedOrder(clips).map((clip) => {
          const badge = readBadge(clip);
          return (
            <li key={clip.id}>
              <button type="button" className="library__clip" disabled={busy} onClick={() => onOpen(clip)}>
                <span className="library__title">{clip.title}</span>
                <Badge tone={badge.tone}>{badge.text}</Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </Disclosure>
  );
}
