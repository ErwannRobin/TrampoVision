import { createMediaPipeEstimator } from './MediaPipePoseEstimator';
import type { PoseEngineId, PoseEstimatorFactory } from './types';

/**
 * The pose engines the app can run. MediaPipe is the one it was built and tested with; the others are experiments to see whether
 * they follow an athlete better where MediaPipe loses one (upside down, tucked, in a blur). They are loaded on demand.
 */
export const POSE_ENGINES: readonly PoseEngineId[] = ['mediapipe', 'rtmpose', 'vitpose'];

export function estimatorFactory(engine: PoseEngineId = 'mediapipe'): PoseEstimatorFactory {
  if (engine === 'mediapipe') return createMediaPipeEstimator;
  return async (options) => {
    const { createOnnxEstimator } = await import('./onnx/OnnxPoseEstimator');
    return createOnnxEstimator(engine)(options);
  };
}
