import { t } from '../../i18n';
import { Button } from '../kit';

export interface ReadyCardProps {
  fileName: string | null;
  busy: 'idle' | 'loading' | 'analyzing';
  onOpenSetup: () => void;
}

/** The rail before there is an analysis: what is about to happen, and the way to the settings. */
export function ReadyCard({ fileName, busy, onOpenSetup }: ReadyCardProps) {
  const text =
    busy === 'analyzing' ? t('setup.readyBusy') : busy === 'loading' ? t('setup.hintLoading') : t('setup.readyText');
  return (
    <section className="rail-ready">
      <h2 className="rail-ready__title t-brand">{t('setup.readyTitle')}</h2>
      {fileName && (
        <p className="rail-ready__file" title={fileName}>
          {fileName}
        </p>
      )}
      <p className="rail-ready__text">{text}</p>
      <Button icon="sliders" onClick={onOpenSetup}>
        {t('ins.openSettings')}
      </Button>
    </section>
  );
}
