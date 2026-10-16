import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Banner, Button } from '../ui/kit';
import { API, ApiError, clipUrl, listClips, remove, setLabel, unlist } from './api';
import { FILTERS, formatBytes, shortDate, stayText, type Clip, type Filter, type Totals } from './logic';

const KEY_STORE = 'trampovision.moderationKey';

const readKey = () => {
  try {
    return sessionStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
};
const writeKey = (key: string) => {
  try {
    if (key) sessionStorage.setItem(KEY_STORE, key);
    else sessionStorage.removeItem(KEY_STORE);
  } catch {
    /* the key is asked for again after a reload */
  }
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function KeyForm({ error, onKey }: { error: string; onKey: (key: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="mod__login sheet"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onKey(value.trim());
      }}
    >
      <h1 className="mod__title">Moderation</h1>
      <p className="mod__hint">
        Enter the owner’s key (the Worker’s <code>REVIEW_TOKEN</code>). It is kept for this tab only and sent to the
        review service only.
      </p>
      {error && <Banner tone="error">{error}</Banner>}
      <input
        className="mod__input"
        type="password"
        autoComplete="off"
        aria-label="Owner’s key"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={!value.trim()}>
        Open
      </Button>
    </form>
  );
}

function ClipRow({
  clip,
  busy,
  canList,
  onRename,
  onUnlist,
  onDelete,
  onPreview,
}: {
  clip: Clip;
  busy: boolean;
  canList: boolean;
  onRename: (title: string) => void;
  onUnlist: () => void;
  onDelete: () => void;
  onPreview: () => Promise<string>;
}) {
  const [title, setTitle] = useState(clip.label ?? '');
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const urlRef = useRef<string | null>(null);
  useEffect(() => setTitle(clip.label ?? ''), [clip.label]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function preview() {
    setLoading(true);
    setError('');
    try {
      const url = await onPreview();
      urlRef.current = url;
      setSrc(url);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }

  const changed = title.trim() !== '' && title.trim() !== (clip.label ?? '');
  return (
    <li className="mod__clip sheet">
      <div className="mod__meta">
        {clip.listed ? <Badge tone="ok">Listed</Badge> : <Badge>Not listed</Badge>}
        <span>{stayText(clip)}</span>
        <span>{formatBytes(clip.size)}</span>
        <span>Uploaded {shortDate(clip.createdAt)}</span>
        <code title={clip.id}>{clip.id.slice(0, 8)}</code>
      </div>

      <form
        className="mod__title-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) onRename(title.trim());
        }}
      >
        <input
          className="mod__input"
          aria-label="Title in the menu"
          placeholder={clip.listed ? 'Title' : 'Title, to list it'}
          maxLength={60}
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />
        {/* Listing a clip needs a title; a listed clip can be renamed. */}
        <Button type="submit" size="sm" disabled={busy || !changed || (!clip.listed && !canList)}>
          {clip.listed ? 'Rename' : 'List'}
        </Button>
      </form>

      {src ? (
        <video className="mod__video" src={src} controls playsInline preload="metadata" />
      ) : (
        <Button size="sm" icon="film" disabled={loading} onClick={() => void preview()}>
          {loading ? 'Loading…' : 'Preview'}
        </Button>
      )}
      {error && <Banner tone="error">{error}</Banner>}

      <div className="mod__actions">
        {clip.listed && (
          <Button size="sm" disabled={busy} onClick={onUnlist}>
            Take out of the examples
          </Button>
        )}
        <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </li>
  );
}

/** The owner’s page for the clips people shared: every clip, whether it is listed among the examples, and what to do with it. */
export function ModerationPage() {
  const [key, setKey] = useState(readKey);
  const [filter, setFilter] = useState<Filter>('all');
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [maxExamples, setMaxExamples] = useState(0);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const signOut = useCallback((why = '') => {
    writeKey('');
    setKey('');
    setClips(null);
    setError(why);
  }, []);

  const load = useCallback(async () => {
    try {
      const answer = await listClips(key, filter);
      setClips(answer.clips);
      setTotals(answer.totals);
      setMaxExamples(answer.maxExamples);
      setError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signOut(message(err));
      else setError(message(err));
    }
  }, [key, filter, signOut]);

  useEffect(() => {
    if (key) void load();
  }, [key, load]);

  async function act(id: string, work: () => Promise<unknown>) {
    setBusyId(id);
    setError('');
    try {
      await work();
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!API) {
    return (
      <main className="mod">
        <Banner tone="error">
          This build has no review service (VITE_REVIEW_API_URL), so there is nothing to moderate.
        </Banner>
      </main>
    );
  }
  if (!key) {
    return (
      <main className="mod">
        <KeyForm
          error={error}
          onKey={(k) => {
            writeKey(k);
            setError('');
            setKey(k);
          }}
        />
      </main>
    );
  }

  const full = totals !== null && maxExamples > 0 && totals.listed >= maxExamples;
  return (
    <main className="mod">
      <header className="mod__head">
        <a href="/">← Home</a>
        <h1 className="mod__title">Moderation</h1>
        <Button size="sm" onClick={() => signOut()}>
          Sign out
        </Button>
      </header>

      {totals && (
        <p className="mod__hint">
          {totals.clips} clips, {formatBytes(totals.bytes)}. Listed among the examples: {totals.listed}
          {maxExamples > 0 && ` of ${maxExamples}`}.{full && ' The list is full: take one out to list another.'}
        </p>
      )}

      <div className="mod__filters" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? 'primary' : 'secondary'}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {clips === null && !error && <p className="mod__hint">Loading…</p>}
      {clips?.length === 0 && <p className="mod__hint">No clip here.</p>}

      <ul className="mod__list">
        {clips?.map((clip) => (
          <ClipRow
            key={clip.id}
            clip={clip}
            busy={busyId === clip.id}
            canList={!full}
            onRename={(title) => void act(clip.id, () => setLabel(key, clip.id, title))}
            onUnlist={() => {
              if (confirm('Take this clip out of the examples? It stays as a plain link for 90 days.')) {
                void act(clip.id, () => unlist(key, clip.id));
              }
            }}
            onDelete={() => {
              if (confirm('Delete this clip for good? Its link stops working.')) {
                void act(clip.id, () => remove(key, clip.id));
              }
            }}
            onPreview={() => clipUrl(key, clip.id)}
          />
        ))}
      </ul>
    </main>
  );
}
