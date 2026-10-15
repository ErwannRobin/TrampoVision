import type * as Ort from 'onnxruntime-web';
import type { BackendInfo, EstimatorOptions, PoseDetection, PoseEstimator, PoseSource } from '../types';
import { decodeHeatmaps, decodeSimcc, mergeFlipSimcc, type Decoded } from './decode';
import { createPersonDetector, DETECTOR_FILE } from './detector';
import { cropAround, cropToImage, sourceSize, type Box, type Crop } from './geometry';
import { COCO17, HALPE26, HALPE26_FLIP, toLandmarks, type KeypointMap, type ScoredPoint } from './keypointMaps';
import { createSession, fetchModel, loadOrt } from './runtime';

/**
 * Experimental pose engines: a person detector (YOLOX), then a top-down pose model on each person's crop, run with ONNX Runtime
 * Web (WebGPU when possible, else WebAssembly). The models give 2D points only: the 3D (world) landmarks that MediaPipe returns,
 * and the twist estimate that needs them, are not available with these engines.
 */
interface Spec {
  name: string;
  file: string;
  map: KeypointMap;
  /** The crop the model reads, pixels. */
  inputW: number;
  inputH: number;
  /**
   * Read every crop a second time mirrored and average the two (the flip test): `flip[k]` is the keypoint that k becomes in a
   * mirror. Twice the work for a steadier reading; RTMPose's "high effort".
   */
  flip?: readonly number[];
  /** Decodes item `item` of a batch. */
  decode(outputs: Ort.InferenceSession.OnnxValueMapType, names: readonly string[], spec: Spec): Promise<Decoded>;
}

/** What the models were trained on: RGB, minus the mean, over the standard deviation (the usual ImageNet values × 255). */
const MEAN = [123.675, 116.28, 103.53];
const STD = [58.395, 57.12, 57.375];

/** RTMPose's two outputs, the x and y classifications, told apart by their length (the input width and height, times 2). */
async function simccOf(outputs: Ort.InferenceSession.OnnxValueMapType, names: readonly string[], spec: Spec) {
  const a = outputs[names[0]];
  const b = outputs[names[1]];
  const [x, y] = a.dims[2] === spec.inputW * 2 ? [a, b] : [b, a];
  return {
    x: (await x.getData()) as Float32Array,
    y: (await y.getData()) as Float32Array,
    keypoints: x.dims[1],
    binsX: x.dims[2],
    binsY: y.dims[2],
  };
}

async function decodeRtmpose(outputs: Ort.InferenceSession.OnnxValueMapType, names: readonly string[], spec: Spec) {
  const s = await simccOf(outputs, names, spec);
  const { x, y } = spec.flip ? mergeFlipSimcc(s.x, s.y, s.keypoints, s.binsX, s.binsY, spec.flip) : s;
  return decodeSimcc(x, y, s.keypoints, s.binsX, s.binsY);
}

const SPECS = {
  // RTMPose-m, body7 pre-training, Halpe 26 points (feet included). From OpenMMLab's rtmlib release; see scripts/fetch-assets.mjs.
  rtmpose: {
    name: 'RTMPose-m Halpe26 + YOLOX-s',
    file: 'rtmpose_m_halpe26.onnx',
    map: HALPE26,
    inputW: 192,
    inputH: 256,
    decode: decodeRtmpose,
  },
  // RTMPose-x on a 288 × 384 crop, read plain and mirrored: rtmlib's "performance" pose model (its detector, YOLOX-x, is 368 MB
  // and is not used: the crops come from the track the first model followed, see analysis/refinePose.ts).
  'rtmpose-x': {
    name: 'RTMPose-x Halpe26 384×288 (flip test) + YOLOX-s',
    file: 'rtmpose_x_halpe26_384x288.onnx',
    map: HALPE26,
    inputW: 288,
    inputH: 384,
    flip: HALPE26_FLIP,
    decode: decodeRtmpose,
  },
  // ViTPose-base ("simple" decoder), COCO 17 points (no feet beyond the ankle). From the ONNX export on Hugging Face.
  vitpose: {
    name: 'ViTPose-B + YOLOX-s',
    file: 'vitpose_base_simple.onnx',
    map: COCO17,
    inputW: 192,
    inputH: 256,
    async decode(outputs, names, spec) {
      const heat = outputs[names[0]];
      const [, keypoints, height, width] = heat.dims;
      return decodeHeatmaps((await heat.getData()) as Float32Array, keypoints, height, width, spec.inputW, spec.inputH);
    },
  },
} satisfies Record<string, Spec>;

export type OnnxEngine = keyof typeof SPECS;

/** The landmarks an engine gives (the others stay unseen). */
export const onnxEngineJoints = (engine: OnnxEngine): number[] => SPECS[engine].map.filter((k) => k >= 0);

/**
 * Fills `pixels` (RGB, planes, normalized) from the part of the source the crop covers, mirrored when asked; what lies outside the
 * picture is black. `offset`: where in `pixels` (the second item of a batch starts at one image's size).
 */
function drawCrop(
  ctx: CanvasRenderingContext2D,
  video: PoseSource,
  crop: Crop,
  pixels: Float32Array,
  offset: number,
  mirrored: boolean,
): void {
  const { width: w, height: h } = ctx.canvas;
  const size = sourceSize(video);
  const left = crop.cx - crop.w / 2;
  const top = crop.cy - crop.h / 2;
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(size.width, left + crop.w);
  const y1 = Math.min(size.height, top + crop.h);
  ctx.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? w : 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (x1 > x0 && y1 > y0) {
    const sx = w / crop.w;
    const sy = h / crop.h;
    ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, (x0 - left) * sx, (y0 - top) * sy, (x1 - x0) * sx, (y1 - y0) * sy);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const plane = w * h;
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) pixels[offset + c * plane + i] = (rgba[4 * i + c] - MEAN[c]) / STD[c];
  }
}

/**
 * Downloads the detector and the pose model side by side and tells the share of the bytes received. Once everything is in, the
 * progress goes back to unknown: what is left (building the sessions) has no measure.
 */
async function downloadModels(files: string[], onLoad: EstimatorOptions['onLoad']): Promise<void> {
  const parts = new Map<string, { loaded: number; total: number }>();
  // Once one file failed, the others still arriving say nothing: their progress would cover the error the caller now shows.
  let failed = false;
  const report = () => {
    if (!onLoad || failed) return;
    let loaded = 0;
    let total = 0;
    for (const part of parts.values()) {
      loaded += part.loaded;
      total += part.total;
    }
    // A size the server did not tell makes the share unknown rather than wrong.
    const known = parts.size === files.length && [...parts.values()].every((p) => p.total > 0);
    onLoad(known && loaded < total ? loaded / total : undefined);
  };
  try {
    await Promise.all(
      files.map((file) =>
        fetchModel(file, (loaded, total) => {
          parts.set(file, { loaded, total });
          report();
        }),
      ),
    );
  } catch (error) {
    failed = true;
    throw error;
  }
  onLoad?.(undefined);
}

/** A top-down engine: besides finding people itself, it reads the person in boxes it is given (the athlete where another model saw them). */
export interface BoxPoseEstimator extends PoseEstimator {
  /** The people the detector finds in the frame, best first, in source pixels. */
  findPeople(source: PoseSource, maxBoxes: number): Promise<Box[]>;
  /** The pose of the person in each box (source pixels): one detection per box, in the same order. */
  detectInBoxes(source: PoseSource, boxes: readonly Box[]): Promise<PoseDetection[]>;
}

export function createOnnxEstimator(engine: OnnxEngine): (options: EstimatorOptions) => Promise<BoxPoseEstimator> {
  const spec: Spec = SPECS[engine];
  return async (options: EstimatorOptions) => {
    const [ort] = await Promise.all([loadOrt(), downloadModels([DETECTOR_FILE, spec.file], options.onLoad)]);
    const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const { inputW, inputH } = spec;
    const batch = spec.flip ? 2 : 1;

    const canvas = document.createElement('canvas');
    canvas.width = inputW;
    canvas.height = inputH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No 2D canvas');
    const image = 3 * inputW * inputH;
    const pixels = new Float32Array(batch * image);
    const tensor = () => new ort.Tensor('float32', pixels, [batch, 3, inputH, inputW]);

    const detector = await createPersonDetector(ort, options.preferGpu);
    const pose = await createSession(ort, spec.file, options.preferGpu, (s) => {
      pixels.fill(0);
      return s.run({ [s.inputNames[0]]: tensor() });
    });
    const { session } = pose;

    const onGpu = detector.provider === 'webgpu' && pose.provider === 'webgpu';
    const backend: BackendInfo = {
      engine: spec.name,
      delegate: onGpu ? 'GPU' : 'CPU',
      webgpuAvailable,
      fallbackReason: detector.fallbackReason ?? pose.fallbackReason,
    };

    const readBoxes = async (video: PoseSource, boxes: readonly Box[]): Promise<PoseDetection[]> => {
      const { width, height } = sourceSize(video);
      const people: PoseDetection[] = [];
      for (const box of boxes) {
        const crop = cropAround(box, inputW / inputH);
        drawCrop(ctx, video, crop, pixels, 0, false);
        if (spec.flip) drawCrop(ctx, video, crop, pixels, image, true);
        const out = await session.run({ [session.inputNames[0]]: tensor() });
        const { xy, scores } = await spec.decode(out, session.outputNames, spec);
        const points: ScoredPoint[] = Array.from(scores, (score, k) => {
          const p = cropToImage(crop, inputW, inputH, xy[2 * k], xy[2 * k + 1]);
          return { x: p.x / width, y: p.y / height, score };
        });
        people.push({ landmarks: toLandmarks(points, spec.map) });
      }
      return people;
    };

    const estimator: BoxPoseEstimator = {
      backend,
      async detect(video): Promise<PoseDetection[]> {
        return readBoxes(video, await detector.detect(video, options.numPoses));
      },
      findPeople: (video, maxBoxes) => detector.detect(video, maxBoxes),
      detectInBoxes: readBoxes,
      dispose() {
        detector.dispose();
        void session.release();
      },
    };
    return estimator;
  };
}
