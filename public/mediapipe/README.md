# DoodleFace local MediaPipe assets

Face and hand models are byte-for-byte copies of the existing `public/lemonade/` models. WASM/JS loaders are copied from installed `@mediapipe/tasks-vision@1.0.1/wasm`. Original assets remain untouched. No remote model or CDN fetch is needed at runtime. Keep the package and WASM versions aligned.

The original model files did not include an upstream URL; this change preserves their existing provenance rather than inventing a new download source.

SHA-256:

```text
64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  face_landmarker.task
fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1  hand_landmarker.task
e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73  wasm/vision_wasm_internal.js
8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886  wasm/vision_wasm_internal.wasm
da8934057f147b622e82cfb4c0dbd85461c598e268588b5a8ba9ca963a8ff82d  wasm/vision_wasm_module_internal.js
2dabd8e23c60984628beb7bb338764c81a08e6837145273f59578684b5d53c1b  wasm/vision_wasm_module_internal.wasm
e81d715a3d42cc3373602eb2f7aff795d164934db680e32496b65dab537f9658  wasm/vision_wasm_nosimd_internal.js
a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192  wasm/vision_wasm_nosimd_internal.wasm
```

## Forest resident models

Official Google MediaPipe models downloaded on 2026-09-27; served locally without runtime CDN calls. Usage/API documentation: [Image classifier](https://ai.google.dev/edge/mediapipe/solutions/vision/image_classifier), [Interactive segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/interactive_segmenter), [Pose landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker). Model terms/cards are linked from those pages.

- `efficientnet_lite0.tflite`: https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite
- `interactive_segmentation.task`: https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task
- `pose_landmarker_lite.task`: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task

SHA-256:

```text
6c7ab0a6e5dcbf38a8c33b960996a55a3b4300b36a018c4545801de3a3c8bde0  efficientnet_lite0.tflite
38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03  interactive_segmentation.task
59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a  pose_landmarker_lite.task
```

Human segmentation reuses the project's existing `/shampoo-selfie-segmentation.tflite`. Package 1.0.1 declares `BrushMode` in TypeScript but omits its JS export; the positive stroke uses the documented numeric enum value 1.
