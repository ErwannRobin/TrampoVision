import type * as Ort from 'onnxruntime-web';
import type { Box } from './geometry';
import { createSession } from './runtime';
import { decodeYolox } from './yolox';

/** The official YOLOX-s (Megvii, COCO), fixed 640 × 640 input: finds the people a top-down pose model then looks at. */
export const DETECTOR_FILE = 'yolox_s.onnx';
const SIZE = 640;
/** The grey the model was trained with around the picture. */
const PAD = 114;

export interface PersonDetector {
  /** People in the frame, best first, in video pixels. */
  detect(source: HTMLVideoElement, maxBoxes: number): Promise<Box[]>;
  dispose(): void;
  provider: 'webgpu' | 'wasm';
  fallbackReason?: string;
}

export async function createPersonDetector(ort: typeof Ort, preferGpu: boolean): Promise<PersonDetector> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas');

  const input = new Float32Array(3 * SIZE * SIZE);
  const tensor = () => new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
  const opened = await createSession(ort, DETECTOR_FILE, preferGpu, (s) => {
    input.fill(PAD);
    return s.run({ [s.inputNames[0]]: tensor() });
  });
  const { session } = opened;

  return {
    provider: opened.provider,
    fallbackReason: opened.fallbackReason,
    async detect(source, maxBoxes) {
      const { videoWidth: w, videoHeight: h } = source;
      // The picture goes in the top left corner at the largest size that fits, the rest stays grey.
      const ratio = Math.min(SIZE / h, SIZE / w);
      const dw = Math.floor(w * ratio);
      const dh = Math.floor(h * ratio);
      ctx.fillStyle = `rgb(${PAD},${PAD},${PAD})`;
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(source, 0, 0, dw, dh);
      const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
      const plane = SIZE * SIZE;
      // Blue, green, red planes, 0..255 and not normalized: how YOLOX is trained.
      for (let i = 0; i < plane; i++) {
        input[i] = rgba[4 * i + 2];
        input[plane + i] = rgba[4 * i + 1];
        input[2 * plane + i] = rgba[4 * i];
      }
      const out = await session.run({ [session.inputNames[0]]: tensor() });
      const head = (await out[session.outputNames[0]].getData()) as Float32Array;
      return decodeYolox(head, SIZE, ratio, maxBoxes);
    },
    dispose() {
      void session.release();
    },
  };
}
