import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
export interface DoodleModels { face: FaceLandmarker; hand: HandLandmarker; close: () => void }
// Abort checks after every await also dispose models that finish loading after navigation.
export async function createDoodleModels(signal: AbortSignal): Promise<DoodleModels> {
  const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`)
  signal.throwIfAborted()
  for (const delegate of ['GPU', 'CPU'] as const) {
    let face: FaceLandmarker | undefined, hand: HandLandmarker | undefined
    try {
      face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { delegate, modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/face_landmarker.task` },
        runningMode: 'VIDEO', numFaces: 2, minFaceDetectionConfidence: .5, minTrackingConfidence: .5,
      })
      signal.throwIfAborted()
      hand = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { delegate, modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task` },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .45, minTrackingConfidence: .45,
      })
      signal.throwIfAborted()
      const readyFace = face, readyHand = hand
      return { face, hand, close: () => { try { readyFace.close() } finally { readyHand.close() } } }
    } catch (error) {
      try { face?.close() } finally { hand?.close() }
      if (signal.aborted || delegate === 'CPU') throw error
    }
  }
  throw new Error('모델을 불러오지 못했어요.')
}
