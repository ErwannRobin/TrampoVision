import { LM } from '../pose/landmarks';
import type { PoseDetection } from '../pose/types';
import { bodyCenter } from './focus';

/**
 * Chooses the athlete among the people the pose model finds, by the up-and-down travel of their hips: a jumper's hips go through
 * most of the jump height every jump, a spotter's or a judge's barely move, however big or near the camera they are. The
 * detections of each frame (the model gives them without identity) are joined frame to frame into tracks — the nearest hips,
 * gated by the size of the body — and once one track has travelled like a jumper, that track is the athlete.
 *
 * The choice is careful three ways: it answers null while no track travels (the first jump is the warm-up, and a camera that
 * follows the athlete keeps their hips still in the picture — the caller falls back on the motion box); a chosen track that is
 * not seen in a frame (the jumper lands behind the spotter) leaves the frame empty rather than following somebody else, and the
 * track survives the gap; and the title does not change hands at every landing (`CHALLENGER_TRAVEL`).
 */

/** How far back the travel of the hips is measured, seconds: one to two jumps (a jump is 1.4 to 2.2 s). */
const WINDOW_S = 3;
/** A track whose hips travelled less than this, picture heights, is not a jumper yet: on the competition clip the spotter measures up to 0.09 when she bends at a landing, the jumper 0.2 to 0.3. */
const MIN_TRAVEL = 0.1;
/** ... and the travel must have turned around this often in the window: jumps go up and down (3 to 4 turns in 3 s), a spotter who bends down and up turns once. */
const MIN_TURNS = 2;
/** One turn is enough when the hips moved this fast, picture heights a second: a jumper falls at 0.4 to 0.9, a spotter who bends moves at 0.2 (the competition clip). The pose model loses the jumper for whole jumps, so a track of hers often holds one descent or one rise only. */
const MIN_SPEED = 0.35;
/** The speed is read over spans this long, seconds: between two neighbouring frames the jitter of the model would count as speed. */
const SPEED_SPAN_S = { min: 0.12, max: 0.35 };
/** A challenger takes the title only with this much more travel than the holder: the measure wobbles at a landing. */
const CHALLENGER_TRAVEL = 1.3;
/** How long a track lives unseen, seconds: the jumper is hidden behind the spotter for a few frames at a landing. */
const MAX_GAP_S = 0.8;
/** How far the hips may be from where a track expects them, torso lengths: the expected spot allows for the body's speed, so the gate is tight — tight enough that the jumper who lands two torso lengths over a spotter the model missed for a frame is not taken for them... */
const GATE = 1;
/** ... plus this many torso lengths per second unseen, so a track picks its person up again after a gap. */
const GATE_GROWTH_PER_S = 3;
/** ... and never opens wider than this many torso lengths: after a second unseen, anybody nearby would match. */
const GATE_CAP = 4;
/** The gate never closes under this, picture heights: the torso the model reports shrinks to almost nothing in a tuck. */
const GATE_FLOOR = 0.04;
/** Somebody with this ratio of a track's torso (either way) is somebody else, not the tracked person. */
const MAX_SIZE_RATIO = 1.8;
/** How much of the newest torso length enters a track's running size. */
const SIZE_SMOOTHING = 0.2;
/** Two detections whose hips are closer than this many torso lengths are one person found twice, and the second is dropped. */
const DUPLICATE_APART = 0.5;
/** How far under everything the athlete has flown through a track may lie and still be the athlete, picture heights: the bed gives a little, and the camera may drift. */
const BAND_SLACK = 0.08;
/** How recent the track's highest point must be, seconds: a track that took a few of the jumper's hips before settling on the spotter would otherwise carry her height for a whole window. */
const TOP_WINDOW_S = 1;
/** How much of the newest heights enters the remembered band. */
const BAND_SMOOTHING = 0.2;
/** A fast body is the athlete without waiting for a turn when it reaches this far into the flight band from its bottom (0 the bottom, 1 the top): a spotter's bend stays below. */
const BAND_REACH = 0.3;
/** A person is at a station when their hips are within this of it, picture heights. A deep bend leaves the station (and breaks its run): that is fine, the station only has to have held one long run, and a stander does not bend most of the time. */
const STATION_RADIUS = 0.08;
/** A station is a stander's spot once somebody was there without leaving for this long: the jumper dwells at her apex a third of a second every jump, a spotter is at their spot for whole seconds. */
const STANDER_RUN_S = 2;
/** A run survives the model missing the person for this long, seconds. */
const RUN_GAP_S = 0.35;
/** A station is forgotten when nobody was there this long, seconds: it outlives the pose model losing the stander for a while. */
const STATION_HOLD_S = 12;
/** Hips this close to a stander's station are the stander's, picture heights: never given back as the athlete, whoever's track took them (the jumper who lands right behind the spotter hands her track to the spotter for a few frames). */
const STATION_VETO = 0.06;
/** The athlete flies at least this far above a stander in their columns, picture heights: a spotter who bends down fast stays at their own height; a jumper does not. */
const RISE_ABOVE = 0.12;
/** A stander in the same columns as a track is one within this much picture sideways. */
const SAME_COLUMNS = 0.15;
/** A landmark with less visibility than this says nothing about where the body is. */
const SEEN = 0.3;

interface Sample {
  t: number;
  y: number;
}

/**
 * How far the hips went up and down inside the last `windowS` seconds of `samples` (which are in time order): the spread of the
 * heights, with the odd frame where the model slipped ignored (the 10th to 90th part). Units are those of `y`.
 */
export function verticalTravel(samples: readonly Sample[], windowS: number): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const ys = samples.filter((s) => s.t >= last.t - windowS).map((s) => s.y);
  if (ys.length < 4) return 0;
  ys.sort((a, b) => a - b);
  const at = (share: number) => ys[Math.min(ys.length - 1, Math.round(share * (ys.length - 1)))];
  return at(0.9) - at(0.1);
}

/**
 * How often the heights turned around inside the last `windowS` seconds: went up by `swing` or more, then down by as much, counted
 * at every turn. Jumps turn at the top and at the bed; somebody who bends down and comes back up turns once; the jitter of the
 * model, smaller than `swing`, does not count.
 */
export function verticalTurns(samples: readonly Sample[], windowS: number, swing: number): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const inWindow = samples.filter((s) => s.t >= last.t - windowS);
  let turns = 0;
  let direction = 0;
  let extreme: number | null = null;
  for (const { y } of inWindow) {
    if (extreme === null) {
      extreme = y;
      continue;
    }
    if (direction === 0) {
      if (Math.abs(y - extreme) >= swing) direction = Math.sign(y - extreme);
      extreme = direction === 0 ? extreme : y;
    } else if ((y - extreme) * direction > 0) {
      extreme = y;
    } else if (Math.abs(y - extreme) >= swing) {
      turns++;
      direction = -direction;
      extreme = y;
    }
  }
  return turns;
}

/**
 * The fastest the heights moved inside the last `windowS` seconds, units of `y` a second: read over spans of `SPEED_SPAN_S`, so
 * that the jitter of the model between two neighbouring frames does not count as speed.
 */
export function peakVerticalSpeed(samples: readonly Sample[], windowS: number): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const inWindow = samples.filter((s) => s.t >= last.t - windowS);
  let peak = 0;
  for (let i = 0; i < inWindow.length; i++) {
    for (let j = i + 1; j < inWindow.length; j++) {
      const dt = inWindow[j].t - inWindow[i].t;
      if (dt < SPEED_SPAN_S.min) continue;
      if (dt > SPEED_SPAN_S.max) break;
      peak = Math.max(peak, Math.abs(inWindow[j].y - inWindow[i].y) / dt);
    }
  }
  return peak;
}

/** The shoulder-to-hip length of a person, normalized picture heights; falls back on the spread of the points when a side is not seen. */
export function torsoLength(person: PoseDetection): number {
  const point = (i: number) => {
    const p = person.landmarks[i];
    return p && p.visibility >= SEEN ? p : null;
  };
  const mid = (a: number, b: number) => {
    const [p, q] = [point(a), point(b)];
    return p && q ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : null;
  };
  const shoulders = mid(LM.L_SHOULDER, LM.R_SHOULDER);
  const hips = mid(LM.L_HIP, LM.R_HIP);
  if (shoulders && hips) {
    const torso = Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y);
    if (torso > 0.005) return torso;
  }
  // Degenerate landmarks: a third of the height of the points that are seen, so the gate never closes completely.
  const ys = person.landmarks.filter((p) => p.visibility >= SEEN).map((p) => p.y);
  const spread = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  return Math.max(0.02, spread / 3);
}

interface Track {
  hip: { x: number; y: number };
  /** How the hips move, picture heights a second: where they are expected next. */
  velocity: { x: number; y: number };
  torso: number;
  lastSeenT: number;
  samples: Sample[];
  travel: number;
  /** True when the track has travelled and turned like a jumper inside the window. */
  jumps: boolean;
  /** True while this track holds the title of the athlete. */
  chosen: boolean;
}

export class JumperSelector {
  private tracks: Track[] = [];
  /** True once an athlete has been chosen at least once. */
  private everChose = false;
  /** The heights the athlete's hips have flown through (smoothed): null until an athlete was chosen while seen. */
  private band: { low: number; high: number } | null = null;
  /** The athlete's torso length (smoothed): somebody much bigger who walks through the picture is not them. */
  private athleteTorso: number | null = null;
  /** The spots people keep coming back to: where the standers stand (`Station`). */
  private stations: Station[] = [];

  /** `maxAthletes`: jumpers to keep (synchro films two) — the tracks with the most travel. */
  constructor(private readonly maxAthletes = 1) {}

  /**
   * Takes the people of one frame (`timeS` seconds into the clip, landmarks normalized 0..1) and returns the athletes among
   * them: null while no track has travelled like a jumper yet (fall back on the motion box), an empty array when the athlete
   * is known but not seen in this frame (leave the frame empty rather than follow somebody else).
   */
  push(people: PoseDetection[], timeS: number): PoseDetection[] | null {
    this.tracks = this.tracks.filter((track) => timeS - track.lastSeenT <= MAX_GAP_S);

    const observations = dropDuplicates(
      people
        .map((person) => ({ person, hip: bodyCenter(person), torso: torsoLength(person) }))
        // The odd nonsense detection (hips outside the picture, a torso of half the picture) would poison a track's travel.
        .filter((o) => o.hip.x > -0.05 && o.hip.x < 1.05 && o.hip.y > -0.05 && o.hip.y < 1.05 && o.torso < 0.35),
    );

    // Where the standers stand: the spots somebody stays at without leaving. The jumper passes through each height of her
    // flight briefly (even her apex, a third of a second a jump), so her spots never become a stander's station.
    this.stations = this.stations.filter((s) => timeS - s.lastT <= STATION_HOLD_S);
    for (const o of observations) {
      let nearest: Station | null = null;
      let bestD = STATION_RADIUS;
      for (const station of this.stations) {
        const d = Math.hypot(o.hip.x - station.x, o.hip.y - station.y);
        if (d < bestD) {
          bestD = d;
          nearest = station;
        }
      }
      if (nearest) {
        nearest.x += 0.05 * (o.hip.x - nearest.x);
        nearest.y += 0.05 * (o.hip.y - nearest.y);
        if (timeS - nearest.lastT > RUN_GAP_S) nearest.runSince = timeS;
        nearest.lastT = timeS;
        nearest.longestRun = Math.max(nearest.longestRun, timeS - nearest.runSince);
      } else {
        this.stations.push({ x: o.hip.x, y: o.hip.y, runSince: timeS, lastT: timeS, longestRun: 0 });
      }
    }
    const standers = this.stations.filter((s) => s.longestRun >= STANDER_RUN_S);

    // The nearest hips continue a track, the surest pairs first: one person per track, one track per person. The hips are
    // measured against where the track expects them (the last place, moved by the body's speed), so a jumper in full fall
    // stays within a tight gate, and the jumper who lands near a spotter is not taken for them.
    const pairs: { track: Track; index: number; cost: number }[] = [];
    for (const track of this.tracks) {
      observations.forEach((o, index) => {
        const gap = timeS - track.lastSeenT;
        const gate = Math.max(GATE_FLOOR, track.torso * Math.min(GATE_CAP, GATE + GATE_GROWTH_PER_S * gap));
        const predicted = { x: track.hip.x + track.velocity.x * gap, y: track.hip.y + track.velocity.y * gap };
        // The last place counts too: the body turns around at the top of a jump and at the bed.
        const distance = Math.min(
          Math.hypot(o.hip.x - predicted.x, o.hip.y - predicted.y),
          Math.hypot(o.hip.x - track.hip.x, o.hip.y - track.hip.y),
        );
        const ratio = o.torso / track.torso;
        if (distance > gate || ratio > MAX_SIZE_RATIO || ratio < 1 / MAX_SIZE_RATIO) return;
        pairs.push({
          track,
          index,
          cost: distance / Math.max(GATE_FLOOR, track.torso) + 2 * Math.abs(Math.log(ratio)),
        });
      });
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const trackOf = new Map<number, Track>();
    const extended = new Set<Track>();
    for (const { track, index } of pairs) {
      if (extended.has(track) || trackOf.has(index)) continue;
      extended.add(track);
      trackOf.set(index, track);
      const o = observations[index];
      const gap = timeS - track.lastSeenT;
      if (gap > 0) track.velocity = { x: (o.hip.x - track.hip.x) / gap, y: (o.hip.y - track.hip.y) / gap };
      track.hip = o.hip;
      track.torso += SIZE_SMOOTHING * (o.torso - track.torso);
      track.lastSeenT = timeS;
      track.samples.push({ t: timeS, y: o.hip.y });
      if (track.samples[0].t < timeS - 2 * WINDOW_S) {
        track.samples = track.samples.filter((s) => s.t >= timeS - WINDOW_S);
      }
      track.travel = verticalTravel(track.samples, WINDOW_S);
      // Travelled like a jumper: far enough, and either turning like jumps do, or — a track the model holds through one
      // descent or one rise only — turning once at a jumper's speed. The one-turn shortcut opens only once an athlete's
      // flight band is known: a spotter who bends down fast turns once at speed too, and must not make the first choice.
      const turns = verticalTurns(track.samples, WINDOW_S, Math.max(0.03, track.travel / 3));
      const speed = peakVerticalSpeed(track.samples, WINDOW_S);
      // The one-turn shortcut needs more than the turn: an athlete's known flight band, or hips lately well above a stander
      // in the track's columns — a spotter who bends down fast turns once at speed too, but at their own station's height.
      const recentTop = Math.min(...track.samples.filter((s) => s.t >= timeS - TOP_WINDOW_S).map((s) => s.y));
      // Above every stander, wherever they stand: the jumper travels sideways across the bed, and a spotter who bends must
      // not qualify by being above somebody else's lower station.
      const aboveAStander = standers.length > 0 && recentTop < Math.min(...standers.map((s) => s.y)) - RISE_ABOVE;
      // The model loses the jumper for whole jumps and her tracks are short: once her flight band is known, a body moving
      // at a jumper's speed well inside that band is her, without waiting for a turn.
      const hot =
        this.band !== null &&
        track.samples.length >= 3 &&
        speed >= MIN_SPEED &&
        Math.min(...track.samples.map((s) => s.y)) < this.band.high - BAND_REACH * (this.band.high - this.band.low);
      track.jumps =
        hot ||
        (track.travel >= MIN_TRAVEL &&
          (turns >= MIN_TURNS ||
            // One descent or one rise is enough at a jumper's speed — with evidence beyond the motion itself: hips lately
            // well above a stander (no turn needed: the model may hold the jumper through half an arc only), or, inside the
            // known flight band, at least the one turn.
            (speed >= MIN_SPEED && (aboveAStander || (this.band !== null && turns >= 1)))));
    }

    // A person nobody claimed starts a track of their own.
    observations.forEach((o, index) => {
      if (trackOf.has(index)) return;
      const track: Track = {
        hip: o.hip,
        velocity: { x: 0, y: 0 },
        torso: o.torso,
        lastSeenT: timeS,
        samples: [{ t: timeS, y: o.hip.y }],
        travel: 0,
        jumps: false,
        chosen: false,
      };
      this.tracks.push(track);
      trackOf.set(index, track);
    });

    // The athletes: the tracks that travel and turn like jumps, fly clearly above the standers in their columns, and fly in
    // the heights the athlete has flown through. A spotter who bends down fast travels and turns like one jump, but does it
    // at their own station's height; and a track wholly under the remembered band is somebody else. A holder keeps the
    // title against a challenger who does not clearly out-travel them.
    const jumping = this.tracks.filter((track) => {
      if (!track.jumps) return false;
      // The highest the track has been lately: over the last second only, so a few of the jumper's hips taken by mistake
      // before the track settled on somebody low do not carry her height for a whole window.
      const top = Math.min(...track.samples.filter((s) => s.t >= timeS - TOP_WINDOW_S).map((s) => s.y));
      if (this.band !== null && top > this.band.high + BAND_SLACK) return false;
      if (this.athleteTorso !== null && track.torso / this.athleteTorso > MAX_SIZE_RATIO) return false;
      return standers.every((s) => Math.abs(track.hip.x - s.x) > SAME_COLUMNS || top < s.y - RISE_ABOVE);
    });
    // While nobody has ever travelled like a jumper, the caller's motion box knows better (null). Once somebody has, it does
    // not: when every jumping track is lost (the model loses the jumper for whole jumps), a frame left empty is better than
    // the motion box handing the frames to the spotter.
    if (jumping.length === 0) return this.everChose ? [] : null;
    jumping.sort(
      (a, b) => b.travel * (b.chosen ? CHALLENGER_TRAVEL : 1) - a.travel * (a.chosen ? CHALLENGER_TRAVEL : 1),
    );
    const athletes = new Set(jumping.slice(0, Math.max(1, Math.floor(this.maxAthletes))));
    for (const track of this.tracks) track.chosen = athletes.has(track);
    this.everChose = true;
    for (const track of athletes) {
      const ys = track.samples.map((s) => s.y);
      const low = Math.min(...ys);
      const high = Math.max(...ys);
      this.band = this.band
        ? {
            low: this.band.low + BAND_SMOOTHING * (low - this.band.low),
            high: this.band.high + BAND_SMOOTHING * (high - this.band.high),
          }
        : { low, high };
      this.athleteTorso = this.athleteTorso
        ? this.athleteTorso + BAND_SMOOTHING * (track.torso - this.athleteTorso)
        : track.torso;
    }

    const kept: number[] = [];
    observations.forEach((o, index) => {
      const track = trackOf.get(index);
      if (!track || !athletes.has(track)) return;
      // Hips on a stander's spot are the stander's, whoever's track took them: a frame left empty is better.
      if (standers.some((s) => Math.hypot(o.hip.x - s.x, o.hip.y - s.y) < STATION_VETO)) return;
      kept.push(people.indexOf(o.person));
    });
    return kept.sort((a, b) => a - b).map((i) => people[i]);
  }
}

interface Observation {
  person: PoseDetection;
  hip: { x: number; y: number };
  torso: number;
}

/** A spot somebody keeps coming back to, and how long they once stayed at it without leaving (`longestRun`). */
interface Station {
  x: number;
  y: number;
  /** When the present stay began. */
  runSince: number;
  lastT: number;
  longestRun: number;
}

/** One person found twice by the model: the hips nearly on one spot. The first (the model's surest) stays. */
function dropDuplicates(observations: Observation[]): Observation[] {
  const kept: Observation[] = [];
  for (const o of observations) {
    const double = kept.some(
      (k) => Math.hypot(o.hip.x - k.hip.x, o.hip.y - k.hip.y) < DUPLICATE_APART * Math.max(o.torso, k.torso),
    );
    if (!double) kept.push(o);
  }
  return kept;
}
