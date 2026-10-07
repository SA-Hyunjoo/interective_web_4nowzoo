import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import simdLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import simdBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import noSimdLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url'
import noSimdBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url'

type InitMessage = { type: 'init' }
type FrameMessage = { type: 'frame'; frame: ImageBitmap; timestamp: number }
type ShutdownMessage = { type: 'shutdown' }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InitMessage | FrameMessage | ShutdownMessage>) => void) | null
  postMessage: (message: unknown) => void
  close: () => void
}
let landmarker: HandLandmarker | null = null
let loading: Promise<void> | null = null

async function initialize(): Promise<void> {
  if (landmarker) return
  loading ??= (async () => {
    // A module worker cannot import MediaPipe's loader directly from /public:
    // Vite attempts to transform that dynamic JS import in development.  Passing
    // Vite-emitted asset URLs keeps the worker self-contained in dev and build.
    const simd = await FilesetResolver.isSimdSupported()
    const vision = simd
      ? { wasmLoaderPath: simdLoaderUrl, wasmBinaryPath: simdBinaryUrl }
      : { wasmLoaderPath: noSimdLoaderUrl, wasmBinaryPath: noSimdBinaryUrl }
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { delegate: 'CPU', modelAssetPath: `${import.meta.env.BASE_URL}lemonade/hand_landmarker.task` },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: .56,
      minHandPresenceConfidence: .5,
      minTrackingConfidence: .5,
    })
  })()
  try { await loading } catch (error) { loading = null; throw error }
}

scope.onmessage = async (event: MessageEvent<InitMessage | FrameMessage | ShutdownMessage>) => {
  const message = event.data
  if (message.type === 'shutdown') {
    landmarker?.close()
    landmarker = null
    loading = null
    scope.close()
    return
  }
  try {
    await initialize()
    if (message.type === 'init') {
      scope.postMessage({ type: 'ready' })
      return
    }
    const result = landmarker!.detectForVideo(message.frame, message.timestamp)
    message.frame.close()
    scope.postMessage({
      type: 'result',
      timestamp: message.timestamp,
      landmarks: result.landmarks[0] ?? null,
    })
  } catch (error) {
    if (message.type === 'frame') message.frame.close()
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'hand-worker-failed' })
  }
}
