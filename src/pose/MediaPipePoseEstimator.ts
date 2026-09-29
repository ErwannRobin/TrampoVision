import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { BackendInfo, EstimatorOptions, PoseDetection, PoseEstimator, PoseEstimatorFactory } from './types';

const BASE = import.meta.env.BASE_URL;
type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
let filesetPromise: Promise<Fileset> | null = null;

/** Wasm runtime is served from /mediapipe/wasm (copied there by scripts/fetch-assets.mjs). */
function loadFileset(): Promise<Fileset> {
  filesetPromise ??= FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
  return filesetPromise;
}

function modelUrl(variant: EstimatorOptions['model']): string {
  return `${BASE}models/pose_landmarker_${variant}.task`;
}

async function create(fileset: Fileset, options: EstimatorOptions, delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> {
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: modelUrl(options.model), delegate },
    runningMode: 'VIDEO',
    numPoses: options.numPoses,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
  // The GPU delegate can be created and still fail on the first inference (headless
  // browsers, blocked WebGL, driver issues). Probe once so we can fall back early.
  const probe = document.createElement('canvas');
  probe.width = probe.height = 64;
  landmarker.detectForVideo(probe, 0);
  return landmarker;
}

/**
 * MediaPipe Pose Landmarker running fully in the browser.
 *
 * Note on WebGPU: MediaPipe Tasks Vision only exposes `delegate: "GPU" | "CPU"`. The "GPU"
 * delegate is WebGL-based, not WebGPU. We report `webgpuAvailable` for information only; a
 * true WebGPU backend needs a different runtime (e.g. onnxruntime-web) behind `PoseEstimator`.
 */
export const createMediaPipeEstimator: PoseEstimatorFactory = async (options) => {
  const fileset = await loadFileset();
  const webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

  let landmarker: PoseLandmarker | null = null;
  let delegate: BackendInfo['delegate'] = 'CPU';
  let fallbackReason: string | undefined;

  if (options.preferGpu) {
    try {
      landmarker = await create(fileset, options, 'GPU');
      delegate = 'GPU';
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : String(err);
      console.warn('[pose] GPU delegate failed, falling back to CPU (WASM):', err);
    }
  }
  if (!landmarker) landmarker = await create(fileset, options, 'CPU');

  const backend: BackendInfo = { engine: 'MediaPipe Pose Landmarker', delegate, webgpuAvailable, fallbackReason };
  const lm = landmarker;

  const estimator: PoseEstimator = {
    backend,
    detect(source, timestampMs): PoseDetection[] {
      const result = lm.detectForVideo(source, timestampMs);
      return result.landmarks.map((points, i) => ({
        landmarks: points.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 0 })),
        world: result.worldLandmarks[i]?.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 })),
      }));
    },
    dispose() {
      lm.close();
    },
  };
  return estimator;
};
