import { useMediaQuery } from './hooks';
import { Icon, IconButton, Logo, Menu, Segmented, type MenuGroupDef } from './kit';
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
  /** The rail shows the settings. */
  setupOpen: boolean;
  onToggleSetup: () => void;
  /** Choose another video (null hides the button, e.g. while analyzing). */
  onFile: ((file: File) => void) | null;
  /** Go back to the first screen (the logo); null when already there. */
  onHome: (() => void) | null;
}

const AUDIENCES = [
  { value: 'athlete', label: 'Athlete', title: 'Plain answers for each jump' },
  { value: 'coach', label: 'Coach', title: 'Every measurement, chart and threshold' },
] as const;

/** The one bar of the app: where you are, who the interface speaks to, and the few things you do with a clip. */
export function TopBar({
  clip,
  audience,
  onAudience,
  showAudience,
  exportGroups,
  setupOpen,
  onToggleSetup,
  onFile,
  onHome,
}: TopBarProps) {
  const narrow = useMediaQuery('(max-width: 720px)');
  return (
    <header className={clip ? 'topbar topbar--clip' : 'topbar'}>
      <div className="topbar__left">
        {onHome ? (
          <button type="button" className="topbar__home" onClick={onHome} aria-label="TrampoVision: back to the start">
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
        {showAudience && (
          <Segmented<Audience>
            ariaLabel="Interface for"
            size="sm"
            value={audience}
            onChange={onAudience}
            options={AUDIENCES.map((a) => ({ ...a }))}
          />
        )}
        {exportGroups && <Menu label="Export" icon="download" groups={exportGroups} size="sm" iconOnly={narrow} />}
        {clip && <IconButton icon="sliders" label="Settings" pressed={setupOpen} onClick={onToggleSetup} />}
        {onFile && (
          <label className="icon-btn topbar__open" data-tip="Open another video">
            <Icon name="plus" size={18} />
            <input
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              aria-label="Open another video"
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
