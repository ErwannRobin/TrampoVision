import { describe, expect, it } from 'vitest';
import type { Box } from '../pose/onnx/geometry';
import type { BoxPoseEstimator } from '../pose/onnx/OnnxPoseEstimator';
import type { Keypoint, PoseDetection, PoseSource } from '../pose/types';
import { boxOfPose, guideBox, readAgain } from './refinePose';
import { standingPose } from './testPose';
import type { PoseTrack } from './types';

const W = 640;
const H = 480;
const track = (frames: (Keypoint[] | null)[]): PoseTrack => ({
  width: W,
  height: H,
  fps: 30,
  sourceFps: 30,
  times: frames.map((_, i) => i / 30),
  frames,
  backend: 'test',
});

/** A model that reads, in each box, a standing figure filling it, scored `score`; and finds the people it is told about. */
function fakeModel(people: Box[] = [], score = 0.8) {
  const asked: { boxes: Box[]; found: boolean }[] = [];
  const model: BoxPoseEstimator = {
    backend: { engine: 'fake', delegate: 'CPU', webgpuAvailable: false },
    detect: () => [],
    async findPeople() {
      asked.push({ boxes: [], found: true });
      return people;
    },
    async detectInBoxes(_source, boxes): Promise<PoseDetection[]> {
      asked.push({ boxes: [...boxes], found: false });
      return boxes.map((b) => ({
        landmarks: standingPose((b.x1 + b.x2) / 2, b.y2, b.y2 - b.y1).map((p) => ({
          x: p.x / W,
          y: p.y / H,
          visibility: score,
        })),
      }));
    },
    dispose() {},
  };
  return { model, asked };
}

const source = {} as PoseSource;
const read = async () => source;

describe('the box the second model reads', () => {
  it('is the box around the sure points of a reading', () => {
    const p = standingPose(300, 400, 175);
    // From the left shoulder to the right toe, which points forward.
    expect(boxOfPose(p)).toMatchObject({ y2: 400, x1: 300 - 0.13 * 175, x2: 300 + 0.15 * 175 });
    expect(boxOfPose(p.map((q) => ({ ...q, visibility: 0.1 })))).toBeNull();
  });

  it('comes from the frame itself, else from the frames on both sides of a gap, grown', () => {
    const p = (x: number) => standingPose(x, 400, 175);
    const t = track([p(100), null, null, p(400)]);
    expect(guideBox(t, [], 0, 30)?.guessed).toBe(false);
    const g = guideBox(t, [], 1, 30)!;
    expect(g.guessed).toBe(true);
    // A third of the way from 100 to 400 (the box's center sits 1.75 px ahead of the figure's: the toe points forward).
    expect((g.box.x1 + g.box.x2) / 2).toBeCloseTo(200 + 1.75);
    expect(guideBox(track([p(100), null, null, null]), [], 3, 1)).toBeNull();
  });
});

describe('reading the doubtful frames again', () => {
  it('reads only the frames asked, in the first model’s box, without the detector', async () => {
    const frames = [standingPose(200, 400), standingPose(220, 400), standingPose(240, 400)];
    const t = track(frames);
    const { model, asked } = fakeModel();
    const wanted = Uint8Array.from([0, 1, 1]);
    const second = await readAgain([t], wanted, [wanted], model, read, { reach: 30 });
    expect(second[0][0]).toBeNull();
    expect(second[0][1]).not.toBeNull();
    expect(asked.every((a) => !a.found)).toBe(true);
    expect(asked).toHaveLength(2);
  });

  it('puts a guessed box on the person the detector finds there, and keeps a reading alone only when it looks like somebody', async () => {
    const t = track([standingPose(200, 400), null, standingPose(260, 400)]);
    const there: Box = { x1: 200, y1: 220, x2: 260, y2: 400, score: 0.9 };
    const elsewhere: Box = { x1: 500, y1: 220, x2: 560, y2: 400, score: 0.95 };
    const { model, asked } = fakeModel([elsewhere, there]);
    const wanted = Uint8Array.from([0, 1, 0]);
    const second = await readAgain([t], wanted, [wanted], model, read, { reach: 30 });
    expect(asked[0].found).toBe(true);
    expect(asked[1].boxes[0]).toEqual(there);
    expect(second[0][1]).not.toBeNull();

    const weak = fakeModel([there], 0.3);
    const none = await readAgain([t], wanted, [wanted], weak.model, read, { reach: 30 });
    expect(none[0][1]).toBeNull();
  });

  it('does not fill one athlete’s gap with a person another athlete holds in that frame', async () => {
    // Two tracks of the same person (a broadcast clip split into fragments): the second one lost them in frame 1.
    const p = (x: number) => standingPose(x, 400);
    const held = track([p(200), p(205), p(210)]);
    const fragment = track([p(200), null, p(210)]);
    const there: Box = { x1: 180, y1: 220, x2: 230, y2: 400, score: 0.9 };
    const { model } = fakeModel([there]);
    const wanted = Uint8Array.from([0, 1, 0]);
    const second = await readAgain([held, fragment], wanted, [new Uint8Array(3), wanted], model, read, { reach: 30 });
    expect(second[1][1]).toBeNull();
    // Alone, the same gap is filled.
    const alone = await readAgain([fragment], wanted, [wanted], fakeModel([there]).model, read, { reach: 30 });
    expect(alone[0][1]).not.toBeNull();
  });

  it('stops when the analysis is cancelled', async () => {
    const t = track([standingPose(200, 400)]);
    const ctl = new AbortController();
    ctl.abort();
    const { model } = fakeModel();
    const one = Uint8Array.from([1]);
    await expect(readAgain([t], one, [one], model, read, { reach: 30, signal: ctl.signal })).rejects.toThrow();
  });
});
