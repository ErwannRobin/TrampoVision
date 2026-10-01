import type * as Ort from 'onnxruntime-web';
import type { BackendInfo, EstimatorOptions, PoseDetection, PoseEstimator, PoseEstimatorFactory } from '../types';
import { decodeHeatmaps, decodeSimcc, type Decoded } from './decode';
import { createPersonDetector } from './detector';
import { cropAround, cropToImage, type Crop } from './geometry';
import { COCO17, HALPE26, toLandmarks, type KeypointMap, type ScoredPoint } from './keypointMaps';
import { createSession, loadOrt } from './runtime';

/**
 * Experimental pose engines: a person detector (YOLOX), then a top-down pose model on each person's crop, run with ONNX Runtime
 * Web (WebGPU when possible, else WebAssembly). Both models take a 192 × 256 crop and give 2D points only: the 3D (world)
 * landmarks that MediaPipe returns, and the twist estimate that needs them, are not available with these engines.
 */
interface Spec {
  name: string;
  file: string;
  map: KeypointMap;
  decode(outputs: Ort.InferenceSession.OnnxValueMapType, names: readonly string[]): Promise<Decoded>;
}

const INPUT_W = 192;
const INPUT_H = 256;
/** What both models were trained on: RGB, minus the mean, over the standard deviation (the usual ImageNet values × 255). */
const MEAN = [123.675, 116.28, 103.53];
const STD = [58.395, 57.12, 57.375];

const SPECS = {
  // RTMPose-m, body7 pre-training, Halpe 26 points (feet included). From OpenMMLab's rtmlib release; see scripts/fetch-assets.mjs.
  rtmpose: {
    name: 'RTMPose-m Halpe26 + YOLOX-s',
    file: 'rtmpose_m_halpe26.onnx',
    map: HALPE26,
    async decode(outputs, names) {
      // Two outputs: the x and y classifications. They are told apart by their length (the input width and height, times 2).
      const a = outputs[names[0]];
      const b = outputs[names[1]];
      const [x, y] = a.dims[2] === INPUT_W * 2 ? [a, b] : [b, a];
      const keypoints = x.dims[1];
      return decodeSimcc(
        (await x.getData()) as Float32Array,
        (await y.getData()) as Float32Array,
        keypoints,
        x.dims[2],
        y.dims[2],
      );
    },
  },
  // ViTPose-base ("simple" decoder), COCO 17 points (no feet beyond the ankle). From the ONNX export on Hugging Face.
  vitpose: {
    name: 'ViTPose-B + YOLOX-s',
    file: 'vitpose_base_simple.onnx',
    map: COCO17,
    async decode(outputs, names) {
      const heat = outputs[names[0]];
      const [, keypoints, height, width] = heat.dims;
      return decodeHeatmaps((await heat.getData()) as Float32Array, keypoints, height, width, INPUT_W, INPUT_H);
    },
  },
} satisfies Record<string, Spec>;

export type OnnxEngine = keyof typeof SPECS;

/** Fills `pixels` (RGB, planes, normalized) from the part of the video the crop covers; what lies outside the picture is black. */
function drawCrop(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, crop: Crop, pixels: Float32Array): void {
  const left = crop.cx - crop.w / 2;
  const top = crop.cy - crop.h / 2;
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(video.videoWidth, left + crop.w);
  const y1 = Math.min(video.videoHeight, top + crop.h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, INPUT_W, INPUT_H);
  if (x1 > x0 && y1 > y0) {
    const sx = INPUT_W / crop.w;
    const sy = INPUT_H / crop.h;
    ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, (x0 - left) * sx, (y0 - top) * sy, (x1 - x0) * sx, (y1 - y0) * sy);
  }
  const rgba = ctx.getImageData(0, 0, INPUT_W, INPUT_H).data;
  const plane = INPUT_W * INPUT_H;
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) pixels[c * plane + i] = (rgba[4 * i + c] - MEAN[c]) / STD[c];
  }
}

export function createOnnxEstimator(engine: OnnxEngine): PoseEstimatorFactory {
  const spec: Spec = SPECS[engine];
  return async (options: EstimatorOptions) => {
    const ort = await loadOrt();
    const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

    const canvas = document.createElement('canvas');
    canvas.width = INPUT_W;
    canvas.height = INPUT_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No 2D canvas');
    const pixels = new Float32Array(3 * INPUT_W * INPUT_H);
    const tensor = () => new ort.Tensor('float32', pixels, [1, 3, INPUT_H, INPUT_W]);

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

    const estimator: PoseEstimator = {
      backend,
      async detect(video): Promise<PoseDetection[]> {
        const { videoWidth: width, videoHeight: height } = video;
        const people: PoseDetection[] = [];
        for (const box of await detector.detect(video, options.numPoses)) {
          const crop = cropAround(box, INPUT_W / INPUT_H);
          drawCrop(ctx, video, crop, pixels);
          const out = await session.run({ [session.inputNames[0]]: tensor() });
          const { xy, scores } = await spec.decode(out, session.outputNames);
          const points: ScoredPoint[] = Array.from(scores, (score, k) => {
            const p = cropToImage(crop, INPUT_W, INPUT_H, xy[2 * k], xy[2 * k + 1]);
            return { x: p.x / width, y: p.y / height, score };
          });
          people.push({ landmarks: toLandmarks(points, spec.map) });
        }
        return people;
      },
      dispose() {
        detector.dispose();
        void session.release();
      },
    };
    return estimator;
  };
}
