import { t } from '../i18n';
import { useMediaQuery } from './hooks';
import { Button, Icon, IconButton, Logo, Menu, Segmented, type MenuGroupDef } from './kit';
import { LanguageMenu } from './LanguageMenu';
import { ShortcutsPopover } from './chrome/ShortcutsPopover';
import type { Audience } from './types';

export interface TopBarProps {
  /** The open clip: its name and one line about the analysis ("12 jumps, 14.0 s"); null on the first screen. */
  clip: { name: string; detail: string } | null;
  audience: Audience;
  onAudience: (audience: Audience) => void;
  /** Athlete / coach switch: only when there is an analysis to look at. */
  showAudience: boolean;
  /** Export menu groups; null hides the menu. */
  exportGroups: MenuGroupDef[] | null;
  /** The settings popup is open. */
  setupOpen: boolean;
  onOpenSetup: () => void;
  /** The About page is open; `onAbout` opens it. */
  aboutOpen: boolean;
  onAbout: () => void;
  /** The review mode (label the jumps one at a time); null hides the button, e.g. when there is no analysis to review. */
  review: { open: boolean; onToggle: () => void } | null;
  /** Choose another video (null hides the button, e.g. while analyzing). */
  onFile: ((file: File) => void) | null;
  /** Go back to the first screen (the logo); null when already there. */
  onHome: (() => void) | null;
}

const audiences = () =>
  [
    { value: 'athlete', label: t('topbar.athlete'), title: t('topbar.athleteHint') },
    { value: 'coach', label: t('topbar.coach'), title: t('topbar.coachHint') },
  ] as const;

/** The one bar of the app: where you are, who the interface speaks to, and the few things you do with a clip. */
export function TopBar({
  clip,
  audience,
  onAudience,
  showAudience,
  exportGroups,
  setupOpen,
  onOpenSetup,
  aboutOpen,
  onAbout,
  review,
  onFile,
  onHome,
}: TopBarProps) {
  const narrow = useMediaQuery('(max-width: 720px)');
  const roomy = useMediaQuery('(min-width: 900px)');
  // The text next to the plus is worth its width when there is room: always above 720px, and with the audience switch and the export
  // menu (the advanced tools) only from 900px, where the clip name has already given up its detail line.
  const labeled = !narrow && (roomy || (!showAudience && !exportGroups));
  return (
    <header className={clip ? 'topbar topbar--clip' : 'topbar'}>
      <div className="topbar__left">
        {onHome ? (
          <button type="button" className="topbar__home" onClick={onHome} aria-label={t('topbar.home')}>
            <Logo />
          </button>
        ) : (
          <Logo />
        )}
        {clip && (
          <div className="topbar__clip">
            <span className="topbar__name" title={clip.name}>
              {clip.name}
            </span>
            {clip.detail && <span className="topbar__detail">{clip.detail}</span>}
          </div>
        )}
      </div>

      <div className="topbar__right">
        <LanguageMenu compact={narrow} align={showAudience ? 'start' : 'end'} />
        {showAudience && (
          <Segmented<Audience>
            ariaLabel={t('topbar.audience')}
            size="sm"
            value={audience}
            onChange={onAudience}
            options={audiences().map((a) => ({ ...a }))}
          />
        )}
        {exportGroups && (
          <Menu label={t('topbar.export')} icon="download" groups={exportGroups} size="sm" iconOnly={narrow} />
        )}
        {review &&
          (labeled ? (
            <Button
              variant="ghost"
              size="sm"
              icon="tag"
              aria-pressed={review.open}
              title={t('rm.openHint')}
              onClick={review.onToggle}
            >
              {t('rm.open')}
            </Button>
          ) : (
            <IconButton icon="tag" label={t('rm.open')} pressed={review.open} onClick={review.onToggle} />
          ))}
        <IconButton
          icon="gear"
          label={t('topbar.settings')}
          aria-haspopup="dialog"
          aria-expanded={setupOpen}
          onClick={onOpenSetup}
        />
        <IconButton icon="info" label={t('topbar.about')} pressed={aboutOpen} onClick={onAbout} />
        {onFile && (
          <label
            className={labeled ? 'btn btn--ghost btn--sm topbar__open' : 'icon-btn topbar__open'}
            data-tip={labeled ? undefined : t('topbar.openAnother')}
          >
            <Icon name="plus" size={labeled ? 15 : 18} />
            {labeled && t('topbar.open')}
            <input
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              aria-label={labeled ? t('topbar.open') : t('topbar.openAnother')}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
          </label>
        )}
        <ShortcutsPopover />
      </div>
    </header>
  );
}
