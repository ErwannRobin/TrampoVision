import { t } from '../../../i18n';
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
        <h2 className="ins-empty__title t-brand">{t('ins.empty.title')}</h2>
        <p className="ins-summary">{t('ins.empty.text')}</p>
        <h3 className="ins-h ins-empty__check">{t('ins.empty.check')}</h3>
        <ul className="ins-checks">
          <li>{t('ins.empty.frame')}</li>
          <li>{t('ins.empty.camera')}</li>
          <li>{t('ins.empty.settings')}</li>
        </ul>
        <Button icon="sliders" onClick={onOpenSetup}>
          {t('ins.openSettings')}
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
