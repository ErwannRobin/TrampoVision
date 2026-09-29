/** A 2D point (units depend on context: normalized [0,1] or image pixels, y pointing down). */
export interface Point {
  x: number;
  y: number;
}

/** A landmark with the model's per-point visibility score in [0,1]. */
export interface Keypoint extends Point {
  visibility: number;
}

/** 3D landmark in meters, hip-centered (MediaPipe "world" landmarks). */
export interface WorldPoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export type ModelVariant = 'lite' | 'full' | 'heavy';

export interface EstimatorOptions {
  model: ModelVariant;
  /** Max people the model looks for. The athlete is picked by `selectAthlete`. */
  numPoses: number;
  /** Try the GPU delegate first and fall back to CPU (WASM) if it fails. */
  preferGpu: boolean;
}

export interface BackendInfo {
  engine: string;
  /** Delegate that is actually running. */
  delegate: 'GPU' | 'CPU';
  /** True when the browser exposes WebGPU (informational; see MediaPipePoseEstimator). */
  webgpuAvailable: boolean;
  /** Set when the GPU delegate was requested but we had to fall back. */
  fallbackReason?: string;
}

/** One person detected in one frame. Landmarks are normalized to [0,1] image coordinates. */
export interface PoseDetection {
  landmarks: Keypoint[];
  world?: WorldPoint[];
}

/**
 * Backend-agnostic pose estimator. The MVP ships a MediaPipe implementation; a WebGPU
 * (e.g. onnxruntime-web) or higher-accuracy model can be dropped in behind this interface
 * as long as it outputs the 33-point MediaPipe/BlazePose topology (see landmarks.ts).
 */
export interface PoseEstimator {
  readonly backend: BackendInfo;
  /** `timestampMs` must be strictly increasing between calls. */
  detect(source: HTMLVideoElement, timestampMs: number): PoseDetection[];
  dispose(): void;
}

export type PoseEstimatorFactory = (options: EstimatorOptions) => Promise<PoseEstimator>;
