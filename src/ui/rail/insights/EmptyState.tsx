import { Button } from '../../kit';
import { DataChecks, Folds } from './WorthKnowing';

interface Props {
  notes: string[];
  onOpenSetup: () => void;
}

/** No jump in the clip: why that is, what to check, and the way to the settings. */
export function EmptyState({ notes, onOpenSetup }: Props) {
  return (
    <>
      <section className="ins-empty">
        <h2 className="ins-empty__title t-brand">No jump found</h2>
        <p className="ins-summary">
          The center of mass never rose 0.3 m above its surroundings, so nothing in this clip counts as a jump.
        </p>
        <h3 className="ins-h ins-empty__check">Check that</h3>
        <ul className="ins-checks">
          <li>The whole athlete is in the frame from start to end.</li>
          <li>The camera is fixed and level, and does not follow the athlete.</li>
          <li>The athlete height and the trampoline size are right in the settings, because meters come from them.</li>
        </ul>
        <Button icon="sliders" onClick={onOpenSetup}>
          Open settings
        </Button>
      </section>
      {notes.length > 0 && (
        <Folds>
          <DataChecks notes={notes} />
        </Folds>
      )}
    </>
  );
}
