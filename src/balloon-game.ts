import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { registerCaptureProvider } from './capture-controller'

interface Point { x: number; y: number }

interface HandState {
  key: string
  index: Point
  pinch: Point
  pinching: boolean
}

interface Balloon {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  baseRadius: number
  radiusX: number
  radiusY: number
  stringLength: number
  color: string
  shade: string
  light: string
  sprite: HTMLCanvasElement
  hue: number
  inflation: number
  blowingFor: number
  phase: number
  grabbedBy: string | null
}

interface Fragment {
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  spin: number
  width: number
  height: number
  color: string
  life: number
  maxLife: number
}

export interface BalloonGameController { resize: () => void }

const BALLOON_COLORS = [
  ['#ff637c', '#bd244c', '#ffd5df'], ['#ff9f43', '#c85a1a', '#ffe0ac'], ['#ffd34e', '#c48a12', '#fff0ad'],
  ['#69d78a', '#21875a', '#d4ffe3'], ['#50bde6', '#176aa7', '#d3f7ff'], ['#8d83ec', '#4e42aa', '#e2ddff'],
  ['#d77eea', '#913bba', '#f9d8ff'], ['#f68ab5', '#b83773', '#ffd4e8'],
] as const

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

function balloonPath(context: CanvasRenderingContext2D, radiusX: number, radiusY: number): void {
  context.beginPath()
  context.moveTo(0, -radiusY)
  context.bezierCurveTo(radiusX * .76, -radiusY, radiusX, -radiusY * .34, radiusX, radiusY * .08)
  context.bezierCurveTo(radiusX, radiusY * .7, radiusX * .5, radiusY, 0, radiusY)
  context.bezierCurveTo(-radiusX * .5, radiusY, -radiusX, radiusY * .7, -radiusX, radiusY * .08)
  context.bezierCurveTo(-radiusX, -radiusY * .34, -radiusX * .76, -radiusY, 0, -radiusY)
  context.closePath()
}

function createRealisticBalloonSprite(color: string, shade: string, light: string): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  const radiusX = 88
  const radiusY = 88
  const centerX = 128
  const centerY = 112
  sprite.width = 256
  sprite.height = 250
  const context = sprite.getContext('2d')!
  context.translate(centerX, centerY)

  const latex = context.createRadialGradient(-radiusX * .34, -radiusY * .42, radiusX * .025, radiusX * .1, radiusY * .16, radiusY * 1.3)
  latex.addColorStop(0, light)
  latex.addColorStop(.12, color)
  latex.addColorStop(.57, color)
  latex.addColorStop(.84, shade)
  latex.addColorStop(1, '#25172c')
  balloonPath(context, radiusX, radiusY)
  context.fillStyle = latex
  context.fill()

  context.save()
  balloonPath(context, radiusX, radiusY)
  context.clip()
  const edgeShade = context.createLinearGradient(-radiusX, 0, radiusX, 0)
  edgeShade.addColorStop(0, 'rgba(10, 10, 28, .4)')
  edgeShade.addColorStop(.18, 'rgba(255,255,255,0)')
  edgeShade.addColorStop(.66, 'rgba(0,0,0,0)')
  edgeShade.addColorStop(1, 'rgba(10, 8, 23, .5)')
  context.fillStyle = edgeShade
  context.fillRect(-radiusX * 1.2, -radiusY * 1.15, radiusX * 2.4, radiusY * 2.3)

  context.filter = 'blur(5px)'
  const gloss = context.createRadialGradient(-radiusX * .34, -radiusY * .48, 1, -radiusX * .25, -radiusY * .35, radiusY * .5)
  gloss.addColorStop(0, 'rgba(255,255,255,.9)')
  gloss.addColorStop(.17, 'rgba(255,255,255,.42)')
  gloss.addColorStop(.58, 'rgba(255,255,255,.05)')
  gloss.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gloss
  context.beginPath()
  context.ellipse(-radiusX * .29, -radiusY * .38, radiusX * .33, radiusY * .54, -.42, 0, Math.PI * 2)
  context.fill()
  context.filter = 'none'

  context.globalAlpha = .32
  context.strokeStyle = 'rgba(255,255,255,.8)'
  context.lineWidth = 1.35
  context.beginPath()
  context.bezierCurveTo(-radiusX * .62, -radiusY * .53, -radiusX * .49, -radiusY * .86, -radiusX * .1, -radiusY * .91)
  context.stroke()
  context.globalAlpha = 1
  context.restore()

  balloonPath(context, radiusX, radiusY)
  context.strokeStyle = 'rgba(255,255,255,.22)'
  context.lineWidth = 1.2
  context.stroke()

  const knot = context.createLinearGradient(0, radiusY * .76, 0, radiusY * 1.22)
  knot.addColorStop(0, light)
  knot.addColorStop(.38, color)
  knot.addColorStop(1, shade)
  context.fillStyle = knot
  context.beginPath()
  context.moveTo(-radiusX * .1, radiusY * 1.035)
  context.lineTo(radiusX * .1, radiusY * 1.035)
  context.lineTo(radiusX * .075, radiusY * 1.15)
  context.lineTo(0, radiusY * 1.25)
  context.lineTo(-radiusX * .075, radiusY * 1.15)
  context.closePath()
  context.fill()
  context.strokeStyle = 'rgba(15,10,25,.35)'
  context.lineWidth = 1
  context.stroke()
  return sprite
}

function createImageBalloonSprite(image: HTMLImageElement, hue: number): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  sprite.width = 256
  sprite.height = 250
  const context = sprite.getContext('2d')!
  context.filter = `hue-rotate(${hue - 202}deg) saturate(1.24) contrast(1.04)`
  context.drawImage(image, 306, 42, 642, 765, 40, 24, 176, 176)
  context.drawImage(image, 552, 795, 155, 78, 109, 200, 38, 38)
  context.filter = 'none'
  return sprite
}

interface SavedCapture {
  id: string
  kind: 'photo' | 'video'
  mime: string
  createdAt: number
  blob: Blob
}

const CAPTURE_DB = 'playroom-balloon-captures'

function captureDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CAPTURE_DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('captures')) request.result.createObjectStore('captures', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function putCapture(capture: SavedCapture): Promise<void> {
  const database = await captureDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('captures', 'readwrite')
    transaction.objectStore('captures').put(capture)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

async function getCaptures(): Promise<SavedCapture[]> {
  const database = await captureDatabase()
  const captures = await new Promise<SavedCapture[]>((resolve, reject) => {
    const request = database.transaction('captures', 'readonly').objectStore('captures').getAll()
    request.onsuccess = () => resolve(request.result as SavedCapture[])
    request.onerror = () => reject(request.error)
  })
  database.close()
  return captures.sort((first, second) => second.createdAt - first.createdAt)
}

async function removeCapture(id: string): Promise<void> {
  const database = await captureDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('captures', 'readwrite')
    transaction.objectStore('captures').delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

export function setupBalloonGame(container: HTMLElement, isActive: () => boolean): BalloonGameController {
  const video = container.querySelector<HTMLVideoElement>('#balloonVideo')!
  const canvas = container.querySelector<HTMLCanvasElement>('#balloonCanvas')!
  const context = canvas.getContext('2d')!
  const permission = container.querySelector<HTMLElement>('#balloonPermission')!
  const permissionCopy = container.querySelector<HTMLElement>('#balloonPermissionCopy')!
  const retryButton = container.querySelector<HTMLButtonElement>('#balloonRetry')!
  const photoButton = container.querySelector<HTMLButtonElement>('#balloonPhotoButton')!
  const videoButton = container.querySelector<HTMLButtonElement>('#balloonVideoButton')!
  const galleryButton = container.querySelector<HTMLButtonElement>('#balloonGalleryButton')!
  const galleryCloseButton = container.querySelector<HTMLButtonElement>('#balloonGalleryClose')!
  const gallery = container.querySelector<HTMLElement>('#balloonGallery')!
  const galleryList = container.querySelector<HTMLElement>('#balloonGalleryList')!
  const archiveCount = container.querySelector<HTMLElement>('#balloonArchiveCount')!
  const captureStatus = container.querySelector<HTMLElement>('#balloonCaptureStatus')!

  let width = 1280
  let height = 720
  let pixelRatio = 1
  let stream: MediaStream | null = null
  let handLandmarker: HandLandmarker | null = null
  let handLandmarkerPromise: Promise<HandLandmarker> | null = null
  let faceLandmarker: FaceLandmarker | null = null
  let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null
  let cameraStarted = false
  let starting = false
  let attemptedForView = false
  let wasVisible = false
  let lastVideoTime = -1
  let lastDetectionAt = 0
  let lastFaceDetectionAt = 0
  let lastFrame = performance.now()
  let spawnTimer = 0
  let nextBalloonId = 1
  let balloons: Balloon[] = []
  let fragments: Fragment[] = []
  let mouth: Point | null = null
  let recording = false
  let recorder: MediaRecorder | null = null
  let recordStream: MediaStream | null = null
  let recordChunks: Blob[] = []
  let galleryUrls: string[] = []
  const balloonImage = new Image()
  let balloonImageReady = false
  const hands = new Map<string, HandState>()
  const balloonSprites = new Map<string, HTMLCanvasElement>()
  const imageSprites = new Map<number, HTMLCanvasElement>()

  registerCaptureProvider({
    isAvailable: () => isActive() && cameraStarted,
    draw: (captureContext, captureWidth, captureHeight) => {
      captureContext.fillStyle = '#0d1f2a'
      captureContext.fillRect(0, 0, captureWidth, captureHeight)
      captureContext.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, captureWidth, captureHeight)
    },
  })

  function spriteForHue(hue: number, fallback: HTMLCanvasElement): HTMLCanvasElement {
    if (!balloonImageReady) return fallback
    const cacheKey = Math.round(hue / 12) * 12
    let sprite = imageSprites.get(cacheKey)
    if (!sprite) {
      sprite = createImageBalloonSprite(balloonImage, cacheKey)
      imageSprites.set(cacheKey, sprite)
    }
    return sprite
  }

  balloonImage.addEventListener('load', () => {
    balloonImageReady = true
    balloons.forEach((balloon) => { balloon.sprite = spriteForHue(balloon.hue, balloon.sprite) })
  })
  balloonImage.src = `${import.meta.env.BASE_URL}ballon.png`

  function setCaptureStatus(message: string, persist = false): void {
    captureStatus.textContent = message
    captureStatus.hidden = false
    if (!persist) window.setTimeout(() => {
      if (!recording) captureStatus.hidden = true
    }, 2600)
  }

  function captureId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function videoMimeType(): string | null {
    if (!('MediaRecorder' in window)) return null
    const mp4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
    return mp4 ?? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)) ?? null
  }

  async function refreshGallery(): Promise<void> {
    try {
      const captures = await getCaptures()
      archiveCount.textContent = String(captures.length)
      galleryUrls.forEach((url) => URL.revokeObjectURL(url))
      galleryUrls = []
      galleryList.replaceChildren()
      if (captures.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'balloon-gallery-empty'
        empty.textContent = '아직 보관한 사진과 영상이 없어요.'
        galleryList.append(empty)
        return
      }
      captures.forEach((capture) => {
        const card = document.createElement('article')
        card.className = 'balloon-capture-card'
        const url = URL.createObjectURL(capture.blob)
        galleryUrls.push(url)
        if (capture.kind === 'photo') {
          const image = document.createElement('img')
          image.src = url
          image.alt = '저장한 Balloon 사진'
          card.append(image)
        } else {
          const clip = document.createElement('video')
          clip.src = url
          clip.controls = true
          clip.muted = true
          clip.playsInline = true
          card.append(clip)
        }
        const meta = document.createElement('div')
        meta.className = 'balloon-capture-meta'
        const label = document.createElement('span')
        const stamp = new Date(capture.createdAt)
        label.textContent = `${capture.kind === 'photo' ? 'PHOTO' : capture.mime.includes('mp4') ? 'MP4' : 'WEBM'} · ${stamp.toLocaleDateString('ko-KR')}`
        const download = document.createElement('a')
        download.href = url
        download.download = `balloon-${capture.id}.${capture.kind === 'photo' ? 'jpg' : capture.mime.includes('mp4') ? 'mp4' : 'webm'}`
        download.textContent = '↓'
        download.setAttribute('aria-label', '파일 저장')
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.textContent = '×'
        remove.setAttribute('aria-label', '보관함에서 삭제')
        remove.addEventListener('click', async () => {
          await removeCapture(capture.id)
          await refreshGallery()
        })
        meta.append(label, download, remove)
        card.append(meta)
        galleryList.append(card)
      })
    } catch {
      setCaptureStatus('보관함을 열 수 없어요')
    }
  }

  async function takePhoto(): Promise<void> {
    if (recording) return
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .93))
      if (!blob) throw new Error('photo-encode-failed')
      await putCapture({ id: captureId(), kind: 'photo', mime: 'image/jpeg', createdAt: Date.now(), blob })
      await refreshGallery()
      setCaptureStatus('사진을 보관함에 저장했어요')
    } catch {
      setCaptureStatus('사진을 저장하지 못했어요')
    }
  }

  async function startRecording(): Promise<void> {
    const mime = videoMimeType()
    if (recording || !mime || !canvas.captureStream) {
      setCaptureStatus('이 브라우저에서는 영상 녹화를 지원하지 않아요')
      return
    }
    try {
      recordStream = canvas.captureStream(24)
      recorder = new MediaRecorder(recordStream, { mimeType: mime, videoBitsPerSecond: 2_600_000 })
      recordChunks = []
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) recordChunks.push(event.data)
      })
      recorder.addEventListener('stop', async () => {
        const type = recorder?.mimeType || mime
        const blob = new Blob(recordChunks, { type })
        recordStream?.getTracks().forEach((track) => track.stop())
        recordStream = null
        recorder = null
        recordChunks = []
        recording = false
        videoButton.classList.remove('recording')
        videoButton.innerHTML = '<i aria-hidden="true"></i> VIDEO'
        try {
          await putCapture({ id: captureId(), kind: 'video', mime: type, createdAt: Date.now(), blob })
          await refreshGallery()
          setCaptureStatus(`${type.includes('mp4') ? 'MP4' : 'WEBM'} 영상을 보관함에 저장했어요`)
        } catch {
          setCaptureStatus('영상을 저장하지 못했어요')
        }
      }, { once: true })
      recorder.start(750)
      recording = true
      videoButton.classList.add('recording')
      videoButton.innerHTML = '<i aria-hidden="true"></i> STOP'
      setCaptureStatus(mime.includes('mp4') ? '● MP4 영상 녹화 중' : '● 이 브라우저는 WEBM으로 녹화 중', true)
    } catch {
      recordStream?.getTracks().forEach((track) => track.stop())
      recordStream = null
      recorder = null
      setCaptureStatus('영상 녹화를 시작하지 못했어요')
    }
  }

  function toggleRecording(): void {
    if (recording) recorder?.stop()
    else void startRecording()
  }

  function toScreen(landmark: { x: number; y: number }): Point {
    const sourceWidth = video.videoWidth || width
    const sourceHeight = video.videoHeight || height
    const scale = Math.max(width / sourceWidth, height / sourceHeight)
    const renderWidth = sourceWidth * scale
    const renderHeight = sourceHeight * scale
    return {
      x: (width - renderWidth) / 2 + (1 - landmark.x) * renderWidth,
      y: (height - renderHeight) / 2 + landmark.y * renderHeight,
    }
  }

  function createBalloon(): Balloon {
    const size = 32 + Math.random() * 34
    const palette = BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)]
    const hue = Math.floor(Math.random() * 360)
    const radius = size * (.92 + Math.random() * .1)
    const radiusX = radius
    const radiusY = radius
    const spriteKey = palette.join('|')
    let sprite = balloonSprites.get(spriteKey)
    if (!sprite) {
      sprite = createRealisticBalloonSprite(palette[0], palette[1], palette[2])
      balloonSprites.set(spriteKey, sprite)
    }
    return {
      id: nextBalloonId++,
      x: width * (.06 + Math.random() * .88),
      y: height + radiusY + 20 + Math.random() * height * .16,
      vx: (Math.random() - .5) * 17,
      vy: -(18 + Math.random() * 24),
      baseRadius: radius,
      radiusX,
      radiusY,
      stringLength: 74 + size * (1.45 + Math.random() * .5),
      color: palette[0],
      shade: palette[1],
      light: palette[2],
      sprite: spriteForHue(hue, sprite),
      hue,
      inflation: 0,
      blowingFor: 0,
      phase: Math.random() * Math.PI * 2,
      grabbedBy: null,
    }
  }

  function resetScene(): void {
    balloons = Array.from({ length: 8 }, (_, index) => {
      const balloon = createBalloon()
      balloon.y = height * (.36 + index * .14) + Math.random() * 110
      return balloon
    })
    fragments = []
    spawnTimer = .3
  }

  function attachmentPoint(balloon: Balloon): Point {
    return { x: balloon.x, y: balloon.y + balloon.radiusY * 1.25 }
  }

  function freeStringEnd(balloon: Balloon, now: number): Point {
    const angle = Math.sin(now * .0018 + balloon.phase) * .11
    const start = attachmentPoint(balloon)
    return { x: start.x + Math.sin(angle) * balloon.stringLength, y: start.y + Math.cos(angle) * balloon.stringLength }
  }

  function stopCamera(): void {
    if (recording) recorder?.stop()
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    video.srcObject = null
    cameraStarted = false
    hands.clear()
    mouth = null
    balloons.forEach((balloon) => { balloon.grabbedBy = null })
  }

  async function getHandLandmarker(): Promise<HandLandmarker> {
    if (handLandmarker) return handLandmarker
    if (handLandmarkerPromise) return handLandmarkerPromise
    handLandmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}lemonade/wasm`)
      const options = {
        runningMode: 'VIDEO' as const,
        numHands: 2,
        minHandDetectionConfidence: .5,
        minHandPresenceConfidence: .48,
        minTrackingConfidence: .48,
      }
      try {
        return await HandLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}lemonade/hand_landmarker.task`, delegate: 'GPU' },
        })
      } catch {
        return HandLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}lemonade/hand_landmarker.task`, delegate: 'CPU' },
        })
      }
    })()
    try {
      handLandmarker = await handLandmarkerPromise
      return handLandmarker
    } catch (error) {
      handLandmarkerPromise = null
      throw error
    }
  }

  async function getFaceLandmarker(): Promise<FaceLandmarker> {
    if (faceLandmarker) return faceLandmarker
    if (faceLandmarkerPromise) return faceLandmarkerPromise
    faceLandmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}lemonade/wasm`)
      const options = { runningMode: 'VIDEO' as const, numFaces: 1, minFaceDetectionConfidence: .52, minTrackingConfidence: .5 }
      try {
        return await FaceLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}lemonade/face_landmarker.task`, delegate: 'GPU' },
        })
      } catch {
        return FaceLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}lemonade/face_landmarker.task`, delegate: 'CPU' },
        })
      }
    })()
    try {
      faceLandmarker = await faceLandmarkerPromise
      return faceLandmarker
    } catch (error) {
      faceLandmarkerPromise = null
      throw error
    }
  }

  async function startCamera(): Promise<void> {
    if (starting || cameraStarted || attemptedForView || !isActive()) return
    attemptedForView = true
    permission.hidden = true
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      permissionCopy.textContent = '카메라는 HTTPS 또는 localhost 환경에서만 사용할 수 있습니다.'
      permission.hidden = false
      return
    }
    starting = true
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
      })
      if (!isActive()) {
        stream.getTracks().forEach((track) => track.stop())
        stream = null
        return
      }
      video.srcObject = stream
      await video.play()
      cameraStarted = true
      await Promise.all([getHandLandmarker(), getFaceLandmarker()])
    } catch {
      stopCamera()
      permissionCopy.textContent = '브라우저 설정에서 카메라 접근을 허용한 뒤 다시 시도해 주세요.'
      permission.hidden = false
    } finally {
      starting = false
    }
  }

  function detectHands(now: number): void {
    if (!handLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === lastVideoTime || now - lastDetectionAt < 50) return
    lastVideoTime = video.currentTime
    lastDetectionAt = now
    const result = handLandmarker.detectForVideo(video, now)
    const detectedKeys = new Set<string>()

    result.landmarks.forEach((landmarks, handIndex) => {
      const key = result.handedness[handIndex]?.[0]?.categoryName ?? `Hand${handIndex}`
      const thumb = toScreen(landmarks[4])
      const index = toScreen(landmarks[8])
      const palmSize = Math.max(16, distance(toScreen(landmarks[0]), toScreen(landmarks[9])))
      const pinchDistance = distance(thumb, index)
      hands.set(key, { key, index, pinch: { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 }, pinching: pinchDistance < palmSize * .52 })
      detectedKeys.add(key)
    })

    hands.forEach((_, key) => {
      if (!detectedKeys.has(key)) hands.delete(key)
    })
  }

  function detectMouth(now: number): void {
    if (!faceLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || now - lastFaceDetectionAt < 67) return
    lastFaceDetectionAt = now
    const face = faceLandmarker.detectForVideo(video, now).faceLandmarks[0]
    if (!face) { mouth = null; return }
    const upperLip = toScreen(face[13])
    const lowerLip = toScreen(face[14])
    mouth = { x: (upperLip.x + lowerLip.x) / 2, y: (upperLip.y + lowerLip.y) / 2 }
  }

  function popBalloon(balloon: Balloon): void {
    const origin = { x: balloon.x, y: balloon.y }
    const pieceCount = 13 + Math.floor(Math.random() * 7)
    for (let index = 0; index < pieceCount; index += 1) {
      const angle = (index / pieceCount) * Math.PI * 2 + (Math.random() - .5) * .45
      const speed = 88 + Math.random() * 175 + balloon.radiusX * .65
      fragments.push({
        x: origin.x + Math.cos(angle) * balloon.radiusX * .2,
        y: origin.y + Math.sin(angle) * balloon.radiusY * .2,
        vx: Math.cos(angle) * speed + balloon.vx * .25,
        vy: Math.sin(angle) * speed + balloon.vy * .2,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - .5) * 15,
        width: 5 + Math.random() * 10,
        height: 7 + Math.random() * 15,
        color: index % 4 === 0 ? balloon.light : balloon.color,
        life: .55 + Math.random() * .35,
        maxLife: .9,
      })
    }
    balloons = balloons.filter((candidate) => candidate.id !== balloon.id)
  }

  function closestBalloonString(point: Point, now: number): Balloon | null {
    let candidate: Balloon | null = null
    let closest = 38
    balloons.forEach((balloon) => {
      if (balloon.grabbedBy) return
      const start = attachmentPoint(balloon)
      const end = freeStringEnd(balloon, now)
      const lineX = end.x - start.x
      const lineY = end.y - start.y
      const lengthSquared = lineX * lineX + lineY * lineY
      const progress = clamp(((point.x - start.x) * lineX + (point.y - start.y) * lineY) / lengthSquared, 0, 1)
      const nearest = { x: start.x + lineX * progress, y: start.y + lineY * progress }
      const gap = distance(point, nearest)
      if (gap < closest) { candidate = balloon; closest = gap }
    })
    return candidate
  }

  function updateGrabs(now: number): void {
    balloons.forEach((balloon) => {
      if (balloon.grabbedBy && !hands.get(balloon.grabbedBy)?.pinching) balloon.grabbedBy = null
    })
    hands.forEach((hand) => {
      if (!hand.pinching || balloons.some((balloon) => balloon.grabbedBy === hand.key)) return
      const balloon = closestBalloonString(hand.pinch, now)
      if (balloon) balloon.grabbedBy = hand.key
    })
  }

  function updateBalloons(delta: number, now: number): void {
    updateGrabs(now)
    spawnTimer -= delta
    if (spawnTimer <= 0 && balloons.length < 15) {
      balloons.push(createBalloon())
      spawnTimer = .56 + Math.random() * .75
    }

    balloons.forEach((balloon) => {
      const wind = Math.sin(now * .00115 + balloon.phase) * 10
      balloon.vx += (wind - balloon.vx * .58) * delta
      balloon.vy += (-33 - balloon.vy * .35) * delta
      balloon.x += balloon.vx * delta
      balloon.y += balloon.vy * delta

      const holder = balloon.grabbedBy ? hands.get(balloon.grabbedBy) : null
      if (holder?.pinching) {
        const attachment = attachmentPoint(balloon)
        let dx = attachment.x - holder.pinch.x
        let dy = attachment.y - holder.pinch.y
        const currentLength = Math.hypot(dx, dy) || 1
        dx /= currentLength
        dy /= currentLength
        const targetAttachment = { x: holder.pinch.x + dx * balloon.stringLength, y: holder.pinch.y + dy * balloon.stringLength }
        const nextX = targetAttachment.x
        const nextY = targetAttachment.y - balloon.radiusY * 1.25
        balloon.vx += (nextX - balloon.x) * delta * 3.8
        balloon.vy += (nextY - balloon.y) * delta * 3.8
        balloon.x = nextX
        balloon.y = nextY
      } else {
        balloon.grabbedBy = null
      }
    })

    balloons.slice().forEach((balloon) => {
      const holder = balloon.grabbedBy ? hands.get(balloon.grabbedBy) : null
      const isAtMouth = Boolean(holder?.pinching && mouth && distance(balloon, mouth) < balloon.radiusX * 1.16)
      if (isAtMouth) {
        balloon.blowingFor += delta
        balloon.inflation = clamp(balloon.inflation + delta * .26, 0, .86)
      } else {
        balloon.blowingFor = Math.max(0, balloon.blowingFor - delta * 1.7)
      }
      const inflatedRadius = balloon.baseRadius * (1 + balloon.inflation)
      balloon.radiusX = inflatedRadius
      balloon.radiusY = inflatedRadius
      if (balloon.blowingFor >= 2) popBalloon(balloon)
    })

    balloons = balloons.filter((balloon) => balloon.grabbedBy || balloon.y > -balloon.radiusY * 2)
    const fingers = Array.from(hands.values()).map((hand) => hand.index)
    balloons.slice().forEach((balloon) => {
      const touched = fingers.some((finger) => {
        const offsetX = (finger.x - balloon.x) / balloon.radiusX
        const offsetY = (finger.y - balloon.y) / balloon.radiusY
        return offsetX * offsetX + offsetY * offsetY <= 1
      })
      if (touched) popBalloon(balloon)
    })
  }

  function updateFragments(delta: number): void {
    fragments.forEach((fragment) => {
      fragment.vy += 310 * delta
      fragment.vx *= Math.pow(.12, delta)
      fragment.x += fragment.vx * delta
      fragment.y += fragment.vy * delta
      fragment.rotation += fragment.spin * delta
      fragment.life -= delta
    })
    fragments = fragments.filter((fragment) => fragment.life > 0)
  }

  function drawVideo(): void {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      context.fillStyle = '#0d1f2a'
      context.fillRect(0, 0, width, height)
      return
    }
    const sourceWidth = video.videoWidth || width
    const sourceHeight = video.videoHeight || height
    const scale = Math.max(width / sourceWidth, height / sourceHeight)
    const renderWidth = sourceWidth * scale
    const renderHeight = sourceHeight * scale
    context.save()
    context.translate(width, 0)
    context.scale(-1, 1)
    context.drawImage(video, (width - renderWidth) / 2, (height - renderHeight) / 2, renderWidth, renderHeight)
    context.restore()
  }

  function drawString(balloon: Balloon, now: number): void {
    const start = attachmentPoint(balloon)
    const holder = balloon.grabbedBy ? hands.get(balloon.grabbedBy) : null
    const end = holder?.pinching ? holder.pinch : freeStringEnd(balloon, now)
    context.save()
    context.strokeStyle = 'rgba(255,255,255,.78)'
    context.lineWidth = 1.15
    context.shadowColor = 'rgba(0,0,0,.44)'
    context.shadowBlur = 2
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
    context.stroke()
    context.restore()
  }

  function drawBalloon(balloon: Balloon, now: number): void {
    const wobble = Math.sin(now * .0022 + balloon.phase) * .045
    context.save()
    context.translate(balloon.x, balloon.y)
    context.rotate(wobble)
    context.shadowColor = 'rgba(0,0,0,.28)'
    context.shadowBlur = 16
    context.shadowOffsetY = 10
    context.scale(balloon.radiusX / 88, balloon.radiusY / 88)
    context.drawImage(balloon.sprite, -128, -112)
    context.restore()
  }

  function drawFragments(): void {
    fragments.forEach((fragment) => {
      const opacity = clamp(fragment.life / fragment.maxLife, 0, 1)
      context.save()
      context.globalAlpha = opacity
      context.translate(fragment.x, fragment.y)
      context.rotate(fragment.rotation)
      context.fillStyle = fragment.color
      context.beginPath()
      context.moveTo(-fragment.width * .5, -fragment.height * .5)
      context.lineTo(fragment.width * .5, 0)
      context.lineTo(-fragment.width * .35, fragment.height * .5)
      context.closePath()
      context.fill()
      context.restore()
    })
  }

  function draw(now: number): void {
    context.clearRect(0, 0, width, height)
    drawVideo()
    balloons.forEach((balloon) => drawString(balloon, now))
    balloons.forEach((balloon) => drawBalloon(balloon, now))
    drawFragments()
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect()
    width = Math.max(320, bounds.width)
    height = Math.max(320, bounds.height)
    const pixelBudgetRatio = Math.sqrt(2_100_000 / Math.max(1, width * height))
    pixelRatio = Math.min(devicePixelRatio || 1, 1.4, pixelBudgetRatio)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    resetScene()
  }

  retryButton.addEventListener('click', () => {
    attemptedForView = false
    void startCamera()
  })
  photoButton.addEventListener('click', () => { void takePhoto() })
  videoButton.addEventListener('click', toggleRecording)
  galleryButton.addEventListener('click', () => {
    gallery.hidden = !gallery.hidden
    galleryButton.setAttribute('aria-expanded', String(!gallery.hidden))
    if (!gallery.hidden) void refreshGallery()
  })
  galleryCloseButton.addEventListener('click', () => {
    gallery.hidden = true
    galleryButton.setAttribute('aria-expanded', 'false')
  })

  function tick(now: number): void {
    const delta = Math.min(.035, Math.max(0, (now - lastFrame) / 1000))
    lastFrame = now
    const active = isActive() && !document.hidden
    if (active && !wasVisible) {
      attemptedForView = false
      void startCamera()
    }
    if (!active && wasVisible) stopCamera()
    wasVisible = active
    if (active) {
      if (cameraStarted) {
        detectHands(now)
        detectMouth(now)
      }
      updateBalloons(delta, now)
      updateFragments(delta)
      draw(now)
    }
    requestAnimationFrame(tick)
  }

  window.addEventListener('resize', resize)
  resize()
  void refreshGallery()
  requestAnimationFrame(tick)
  return { resize }
}
