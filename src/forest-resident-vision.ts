import { FilesetResolver, ImageClassifier, ImageSegmenter, InteractiveSegmenter, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

export type ResidentKind = 'human' | 'cat' | 'dog' | 'rabbit' | 'bear' | 'bird' | 'frog' | 'deer' | 'elephant' | 'pig' | 'octopus' | 'object'
export interface ShapeProfile {
  kind: ResidentKind; label: string; confidence: number; aspect: number; fullness: number
  rows: { left: number; right: number; y: number }[]; color: string; seed: number
}
export interface ResidentSkin { cutout: HTMLCanvasElement; landmarks: NormalizedLandmark[]; bounds: { x: number; y: number; w: number; h: number }; color: string; textureEdits?: HTMLCanvasElement[] }
export interface ResidentVision {
  analyze: (image: HTMLCanvasElement) => ShapeProfile
  skin: (photo: HTMLCanvasElement) => ResidentSkin
  close: () => void
}
export function canvas(width: number, height: number) {
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result
}
const types: [ResidentKind, string, RegExp][] = [
  ['rabbit', '토끼', /rabbit|hare|angora/], ['cat', '고양이', /cat|tabby|tiger|lynx|lion|leopard|cheetah|cougar/],
  ['dog', '강아지', /dog|terrier|retriever|hound|spaniel|poodle|collie|shepherd|husky|malamute|pug|corgi|chihuahua|wolf|fox|pinscher|schnauzer|samoyed|pekinese|shih|papillon|dalmatian/],
  ['bear', '곰', /bear|panda|koala|raccoon/], ['frog', '개구리', /frog|toad/], ['elephant', '코끼리', /elephant|tusker/],
  ['deer', '사슴', /deer|antelope|gazelle|ibex|ram|bighorn|ox|bison|buffalo/], ['pig', '돼지', /pig|hog|boar|hippopotamus/],
  ['bird', '새', /bird|finch|robin|jay|magpie|chick|hen|cock|duck|goose|drake|penguin|parrot|macaw|toucan|flamingo|ostrich|crane|egret|heron|eagle|vulture|owl|pelican|grouse|peacock|quail/],
  ['octopus', '문어', /octopus|squid|jellyfish/],
]

export async function createResidentVision(signal: AbortSignal): Promise<ResidentVision> {
  const resources: { close: () => void }[] = []
  function check() { if (signal.aborted) throw new DOMException('취소됨', 'AbortError') }
  async function keep<T extends { close: () => void }>(pending: Promise<T>): Promise<T> { const item = await pending; resources.push(item); check(); return item }
  try {
    const files = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`); check()
    const base = (name: string) => ({ modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/${name}`, delegate: 'CPU' as const })
    const classifier = await keep(ImageClassifier.createFromOptions(files, { baseOptions: base('efficientnet_lite0.tflite'), runningMode: 'IMAGE', maxResults: 5 }))
    const segmenter = await keep(InteractiveSegmenter.createFromOptions(files, { baseOptions: base('interactive_segmentation.task') }))
    const pose = await keep(PoseLandmarker.createFromOptions(files, { baseOptions: base('pose_landmarker_lite.task'), runningMode: 'IMAGE', numPoses: 1, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4 }))
    const human = await keep(ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}shampoo-selfie-segmentation.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false }))
    return {
      analyze(image) {
        check()
        const working = canvas(256, 256), ctx = working.getContext('2d', { willReadFrequently: true })!
        // Preserve proportions for the silhouette and composite transparency for classification.
        const scale = Math.min(236 / image.width, 236 / image.height)
        ctx.drawImage(image, (256 - image.width * scale) / 2, (256 - image.height * scale) / 2, image.width * scale, image.height * scale)
        const source = ctx.getImageData(0, 0, 256, 256)
        const flat = canvas(image.width, image.height), flatContext = flat.getContext('2d')!
        flatContext.fillStyle = '#f4f1e8'; flatContext.fillRect(0, 0, flat.width, flat.height); flatContext.drawImage(image, 0, 0)
        const categories = classifier.classify(flat).classifications[0]?.categories ?? []
        const best = categories[0]
        let kind: ResidentKind = 'object', label = '실루엣', confidence = best?.score ?? 0
        for (const category of categories) {
          if (category.score < 0.09 || category.score < confidence * 0.45) continue
          const found = types.find(([, , pattern]) => pattern.test(category.categoryName.toLowerCase()))
          if (found) { [kind, label] = found; confidence = category.score; break }
        }
        if (kind === 'object') {
          const result = pose.detect(flat)
          try { if (result.landmarks[0]?.length) { kind = 'human'; label = '사람'; confidence = 1 } } finally { result.close() }
        }
        // Transparent artwork already has an exact silhouette; photos use MagicTouch.
        const original = image.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, image.width, image.height)
        let transparent = 0
        for (let i = 3; i < original.data.length; i += 4) if (original.data[i]! < 32) transparent++
        const mask = new Uint8Array(256 * 256)
        if (transparent > image.width * image.height * 0.05) {
          for (let i = 0; i < mask.length; i++) mask[i] = source.data[i * 4 + 3]! > 80 ? 1 : 0
        } else {
          const input = canvas(256, 256), inputCtx = input.getContext('2d')!
          inputCtx.fillStyle = '#f4f1e8'; inputCtx.fillRect(0, 0, 256, 256); inputCtx.drawImage(working, 0, 0)
          segmenter.setImage(input)
          // The installed package declares BrushMode but omits its runtime export; 1 = POSITIVE.
          const result = segmenter.segment([{ brushMode: 1, point: [{ x: 0.5, y: 0.5 }], isCompleted: true }])
          try {
            const values = result.getAsFloat32Array()
            for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) mask[y * 256 + x] = values[Math.floor(y / 256 * result.height) * result.width + Math.floor(x / 256 * result.width)]! > 0.55 && source.data[(y * 256 + x) * 4 + 3]! > 80 ? 1 : 0
          } finally { result.close() }
        }
        let minX = 255, minY = 255, maxX = 0, maxY = 0, count = 0, r = 0, g = 0, b = 0, hash = 2166136261
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (mask[y * 256 + x]) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++
          const i = (y * 256 + x) * 4; r += source.data[i]!; g += source.data[i + 1]!; b += source.data[i + 2]!
          hash = Math.imul(hash ^ source.data[i]!, 16777619) >>> 0
        }
        if (count < 180 || maxY - minY < 12) throw new Error('이미지의 형체를 찾지 못했어요. 형체 하나가 중앙에 크게 나온 이미지를 넣어 주세요.')
        const rows: ShapeProfile['rows'] = []
        for (let y = minY; y <= maxY; y += Math.max(1, Math.floor((maxY - minY) / 60))) {
          let left = maxX, right = minX
          for (let x = minX; x <= maxX; x++) if (mask[y * 256 + x]) { left = Math.min(left, x); right = Math.max(right, x) }
          if (right > left) rows.push({ left: (left - minX) / (maxX - minX), right: (right - minX) / (maxX - minX), y: (y - minY) / (maxY - minY) })
        }
        return { kind, label, confidence, rows, aspect: (maxX - minX) / (maxY - minY), fullness: count / ((maxX - minX + 1) * (maxY - minY + 1)), color: `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`, seed: hash }
      },
      skin(photo) {
        check()
        const result = human.segment(photo)
        const cutout = canvas(photo.width, photo.height), ctx = cutout.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(photo, 0, 0)
        const pixels = ctx.getImageData(0, 0, cutout.width, cutout.height)
        let count = 0, x0 = photo.width, y0 = photo.height, x1 = 0, y1 = 0, r = 0, g = 0, b = 0
        try {
          const masks = result.confidenceMasks
          if (!masks?.length) throw new Error('사람 영역을 찾지 못했어요. 밝은 곳에서 다시 촬영해 주세요.')
          const arrays = masks.map(mask => mask.getAsFloat32Array()), width = masks[0]!.width, height = masks[0]!.height
          for (let y = 0; y < photo.height; y++) for (let x = 0; x < photo.width; x++) {
            const m = Math.floor(y / photo.height * height) * width + Math.floor(x / photo.width * width)
            // Selfie multiclass: 0 background, remaining labels hair/body/face/clothes/accessories.
            let value = arrays.length === 1 ? arrays[0]![m]! : 0
            for (let category = 1; category < arrays.length; category++) value += arrays[category]![m]!
            const i = (y * photo.width + x) * 4
            pixels.data[i + 3] = value >= 0.7 ? 255 : 0
            if (value >= 0.7) { count++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); r += pixels.data[i]!; g += pixels.data[i + 1]!; b += pixels.data[i + 2]! }
            else { pixels.data[i] = 0; pixels.data[i + 1] = 0; pixels.data[i + 2] = 0 }
          }
        } finally { result.close() }
        if (count < photo.width * photo.height * 0.025) throw new Error('사진에서 사람을 찾지 못했어요. 얼굴과 상체가 보이도록 다시 촬영해 주세요.')
        ctx.putImageData(pixels, 0, 0)
        const detected = pose.detect(photo)
        let landmarks: NormalizedLandmark[] = []
        try { landmarks = detected.landmarks[0]?.map(point => ({ ...point })) ?? [] } finally { detected.close() }
        return { cutout, landmarks, bounds: { x: x0 / photo.width, y: y0 / photo.height, w: (x1 - x0 + 1) / photo.width, h: (y1 - y0 + 1) / photo.height }, color: `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})` }
      },
      close: () => resources.splice(0).forEach(resource => resource.close()),
    }
  } catch (error) { resources.forEach(resource => resource.close()); throw error }
}
