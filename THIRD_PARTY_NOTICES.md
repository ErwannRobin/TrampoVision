# Third-party notices

TrampoVision's own code is MIT (see `LICENSE`). It downloads and uses the following at build or run time; they are not stored in this repository and keep their own licenses. Check each upstream before redistributing.

| Component                                                                                                                | Used for                                    | License                          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------- |
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) and the Pose Landmarker models (lite, full, heavy) | Pose estimation (default)                   | Apache-2.0                       |
| [RTMPose / MMPose](https://github.com/open-mmlab/mmpose)                                                                 | Experimental pose engine                    | Apache-2.0                       |
| [ViTPose](https://github.com/ViTAE-Transformer/ViTPose)                                                                  | Experimental pose engine                    | Apache-2.0                       |
| [YOLOX](https://github.com/Megvii-BaseDetection/YOLOX)                                                                   | Person detector of the experimental engines | Apache-2.0                       |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime)                                                             | Runs the ONNX models                        | MIT                              |
| [FFmpeg](https://ffmpeg.org/) via [@ffmpeg/core](https://github.com/ffmpegwasm/ffmpeg.wasm)                              | Video decoding and export                   | LGPL/GPL (ffmpeg), MIT (wrapper) |
| [Archivo](https://github.com/Omnibus-Type/Archivo) via `@fontsource-variable/archivo`                                    | Typeface                                    | SIL OFL 1.1                      |
| [React](https://react.dev)                                                                                               | UI                                          | MIT                              |
| [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)                                                                       | MP4 export                                  | MIT                              |

The exact model files and their licenses are those listed by `scripts/fetch-assets.mjs`; verify the license of each downloaded file.

## Not covered by the MIT license

- **FIG Code of Points.** The app encodes difficulty values and deduction rules from the FIG Code of Points 2025-2028 (Trampoline). The Code belongs to the Fédération Internationale de Gymnastique; TrampoVision is not an official FIG product and is not endorsed by it. Read the official text at https://www.gymnastics.sport/site/rules/.
- **Jev (TypeSafe).** The optional Classification tab calls a third-party API with your own key (`TYPESAFE_API_KEY`). Its terms are TypeSafe's.
- **Sample videos.** None is included. Use clips you have the right to use, with the consent of the people filmed.
