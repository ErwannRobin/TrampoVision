import type { SavedSet, SetFigures, SetSummary } from './store';

/** What is on screen, as far as saving it is concerned. */
export interface SetSnapshot extends SetFigures {
  /** The id of the set: the id of the video. */
  id: string;
  fileName: string;
  /** The raw track the analysis comes from. A new analysis is a new track; a change of settings keeps it. */
  track: object;
  /** The settings that are saved with the series (height, scale, calibration, frame step), as a string. A change rewrites the series. */
  settingsKey: string;
  /** The text of the series. Costly, so it is only made when the series has to be written. */
  serialize: () => string;
}

/** Where a set is written. */
export interface SetWriter {
  save(set: SavedSet): Promise<boolean>;
  update(summary: SetSummary): Promise<boolean>;
}

interface Written {
  id: string;
  track: object;
  /** Null for a stored set that was just opened: its settings are known once the screen has them. */
  settingsKey: string | null;
  figures: string;
}

const figuresKey = (f: SetFigures) => `${f.skills}|${f.pending}|${f.difficulty}|${f.jumps}`;

/** How long the screen has to stay as it is before a set is written: a height typed digit by digit is one write. */
export const AUTOSAVE_DELAY_MS = 800;

/**
 * Keeps the set on screen stored. It writes when an analysis completes and again when what the live view says about the set changes
 * (a skill the coach confirms, changes or deletes), waiting a moment for the screen to settle. Only what changed is written: a
 * correction updates the line of the list, and the series (megabytes) is rewritten only when the analysis or its settings changed.
 * A failed write never throws: `flush` says whether the set on screen is stored.
 */
export class Autosaver {
  private latest: SetSnapshot | null = null;
  private written: Written | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tail: Promise<boolean> = Promise.resolve(true);

  constructor(
    private readonly writer: SetWriter,
    private readonly delayMs = AUTOSAVE_DELAY_MS,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The screen changed. `null`: there is no set to save (none is open, or it is not ready). A write that is waiting for the screen to
   * settle still happens then: what the coach changed a moment ago is not lost by opening another clip.
   */
  update(snapshot: SetSnapshot | null): void {
    this.latest = snapshot;
    if (!snapshot) return;
    clearTimeout(this.timer);
    // The first look at a set that was just opened from the list: what it was stored with is what is on screen.
    const w = this.written;
    if (w && w.settingsKey === null && w.id === snapshot.id && w.track === snapshot.track)
      w.settingsKey = snapshot.settingsKey;
    if (this.isStored(snapshot)) return;
    this.timer = setTimeout(() => void this.enqueue(snapshot), this.delayMs);
  }

  /** The set on screen is this stored set, opened from the list: nothing needs writing until it changes. */
  adopt(stored: SetSummary, track: object): void {
    this.written = { id: stored.id, track, settingsKey: null, figures: figuresKey(stored) };
  }

  /** Writes at once what is waiting. True when the set on screen is stored, false when it is not (or there is none). */
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    return this.latest ? this.enqueue(this.latest) : Promise.resolve(false);
  }

  /** The set was closed: forget it (the next set starts from nothing). */
  reset(): void {
    this.latest = null;
    this.written = null;
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  private isStored(s: SetSnapshot): boolean {
    const w = this.written;
    return (
      !!w && w.id === s.id && w.track === s.track && w.settingsKey === s.settingsKey && w.figures === figuresKey(s)
    );
  }

  /** One write at a time, in the order they were asked for. */
  private enqueue(snapshot: SetSnapshot): Promise<boolean> {
    const run = this.tail.then(() => this.write(snapshot));
    this.tail = run;
    return run;
  }

  private async write(s: SetSnapshot): Promise<boolean> {
    if (this.isStored(s)) return true;
    const w = this.written;
    const sameSeries = !!w && w.id === s.id && w.track === s.track && w.settingsKey === s.settingsKey;
    const line: SetSummary = {
      id: s.id,
      fileName: s.fileName,
      savedAt: this.now().toISOString(),
      skills: s.skills,
      pending: s.pending,
      difficulty: s.difficulty,
      jumps: s.jumps,
    };
    try {
      // Only the line changed: update it. If the stored set is gone (removed, evicted), write the whole set again.
      let ok = sameSeries && (await this.writer.update(line));
      if (!ok) ok = await this.writer.save({ ...line, series: s.serialize() });
      if (ok) this.written = { id: s.id, track: s.track, settingsKey: s.settingsKey, figures: figuresKey(s) };
      return ok;
    } catch {
      return false;
    }
  }
}
