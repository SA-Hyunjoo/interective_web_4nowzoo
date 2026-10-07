import { FaceLandmarker, FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import { registerCaptureProvider } from './capture-controller'

interface Point { x: number; y: number }
interface NormalizedPoint { x: number; y: number; z?: number }
interface SegmentationMask { width: number; height: number; confidence: Float32Array; foreheadY: number }
interface BaseBubble { u: number; v: number; radius: number; phase: number; normalX: number; normalY: number; tangentX: number; tangentY: number; overflow: number; sprite: number }
interface AttachedBubble { landmark: number; offsetX: number; offsetY: number; radius: number; phase: number; sprite: number }
interface FreeBubble { x: number; y: number; radius: number; phase: number; sprite: number }
interface HandState { points: NormalizedPoint[]; pinch: boolean; fist: boolean; seenAt: number }

export interface ShampooController { resize: () => void }

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))
const distance = (first: Point, second: Point): number => Math.hypot(first.x - second.x, first.y - second.y)
const randomBetween = (minimum: number, maximum: number): number => minimum + Math.random() * (maximum - minimum)

export function setupShampooGame(container: HTMLElement, isActive: () => boolean): ShampooController {
  const video = container.querySelector<HTMLVideoElement>('#shampooVideo')!
  const canvas = container.querySelector<HTMLCanvasElement>('#shampooCanvas')!
  const context = canvas.getContext('2d', { alpha: true })!
  const hint = container.querySelector<HTMLElement>('#shampooHint')!
  const detail = container.querySelector<HTMLElement>('#shampooDetail')!

  let width = 1280
  let height = 720
  let pixelRatio = 1
  let stream: MediaStream | null = null
  let faceLandmarker: FaceLandmarker | null = null
  let imageSegmenter: ImageSegmenter | null = null
  let handWorker: Worker | null = null
  let handWorkerReady = false
  let handInFlight = false
  let started = false
  let starting = false
  let wasActive = false
  let lastFaceAt = 0
  let lastSegmentAt = 0
  let lastHandFrameAt = 0
  let lastVideoTime = -1
  let facePoints: Point[] = []
  let faceRaw: NormalizedPoint[] = []
  let segmentation: SegmentationMask | null = null
  let baseBubbles: BaseBubble[] = []
  let attachedBubbles: AttachedBubble[] = []
  let freeBubbles: FreeBubble[] = []
  let hand: HandState | null = null
  let handRevision = 0
  let consumedHandRevision = 0
  let gesture: 'none' | 'pinch' | 'fist' = 'none'
  let lastGestureAt = 0
  let lastPinchPoint: Point | null = null
  let lastFistPoint: Point | null = null
  let lastFistSpawnPoint: Point | null = null
  let lastFistDetectedAt = 0
  let fistStartedOnHead = false
  let nextFistClusterAt = 0
  let shownHint = ''
  let shownDetail = ''
  const sprites = new Map<number, HTMLCanvasElement>()

  registerCaptureProvider({
    isAvailable: () => isActive() && started && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    draw: (captureContext, captureWidth, captureHeight) => {
      const sourceWidth = video.videoWidth || captureWidth
      const sourceHeight = video.videoHeight || captureHeight
      const scale = Math.max(captureWidth / sourceWidth, captureHeight / sourceHeight)
      const renderedWidth = sourceWidth * scale
      const renderedHeight = sourceHeight * scale
      captureContext.fillStyle = '#12191b'
      captureContext.fillRect(0, 0, captureWidth, captureHeight)
      captureContext.save()
      captureContext.translate(captureWidth, 0)
      captureContext.scale(-1, 1)
      captureContext.drawImage(video, (captureWidth - renderedWidth) / 2, (captureHeight - renderedHeight) / 2, renderedWidth, renderedHeight)
      captureContext.restore()
      captureContext.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, captureWidth, captureHeight)
    },
  })

  function toScreen(point: NormalizedPoint): Point {
    const sourceWidth = video.videoWidth || width
    const sourceHeight = video.videoHeight || height
    const scale = Math.max(width / sourceWidth, height / sourceHeight)
    const renderedWidth = sourceWidth * scale
    const renderedHeight = sourceHeight * scale
    return {
      x: (width - renderedWidth) / 2 + (1 - point.x) * renderedWidth,
      y: (height - renderedHeight) / 2 + point.y * renderedHeight,
    }
  }

  function screenToVideo(point: Point): Point {
    const sourceWidth = video.videoWidth || width
    const sourceHeight = video.videoHeight || height
    const scale = Math.max(width / sourceWidth, height / sourceHeight)
    const renderedWidth = sourceWidth * scale
    const renderedHeight = sourceHeight * scale
    return {
      x: clamp(1 - ((point.x - (width - renderedWidth) / 2) / renderedWidth), 0, 1),
      y: clamp((point.y - (height - renderedHeight) / 2) / renderedHeight, 0, 1),
    }
  }

  function faceScale(): number {
    if (facePoints.length < 264) return Math.min(width, height) * .18
    return Math.max(42, distance(facePoints[33], facePoints[263]))
  }

  function faceBasis(): { x: number; y: number } {
    if (facePoints.length < 264) return { x: 1, y: 0 }
    const horizontal = { x: facePoints[263].x - facePoints[33].x, y: facePoints[263].y - facePoints[33].y }
    const length = Math.hypot(horizontal.x, horizontal.y) || 1
    return { x: horizontal.x / length, y: horizontal.y / length }
  }

  function sprite(size: number): HTMLCanvasElement {
    const key = Math.round(size / 4) * 4
    const cached = sprites.get(key)
    if (cached) return cached
    const tile = document.createElement('canvas')
    tile.width = tile.height = 128
    const tileContext = tile.getContext('2d')!
    const center = 64
    const radius = 43
    const drawMicroBubble = (x: number, y: number, bubbleRadius: number): void => {
      const glow = tileContext.createRadialGradient(x - bubbleRadius * .28, y - bubbleRadius * .35, 0, x, y, bubbleRadius)
      glow.addColorStop(0, 'rgba(255,255,255,.55)')
      glow.addColorStop(.56, 'rgba(242,255,251,.09)')
      glow.addColorStop(1, 'rgba(221,246,240,0)')
      tileContext.fillStyle = glow
      tileContext.beginPath()
      tileContext.arc(x, y, bubbleRadius, 0, Math.PI * 2)
      tileContext.fill()
      tileContext.strokeStyle = 'rgba(255,255,255,.68)'
      tileContext.lineWidth = Math.max(1, bubbleRadius * .075)
      tileContext.beginPath()
      tileContext.arc(x, y, bubbleRadius * .84, -.7, Math.PI * 1.03)
      tileContext.stroke()
    }
    // 낮은 밀도의 크리미한 폼이 큰 기포 사이를 부드럽게 연결한다.
    tileContext.save()
    tileContext.filter = 'blur(8px)'
    const foam = tileContext.createRadialGradient(61, 94, 2, 61, 94, 48)
    foam.addColorStop(0, 'rgba(255,255,255,.42)')
    foam.addColorStop(.62, 'rgba(244,255,251,.2)')
    foam.addColorStop(1, 'rgba(242,255,251,0)')
    tileContext.fillStyle = foam
    tileContext.beginPath()
    tileContext.ellipse(62, 94, 48, 16, -.08, 0, Math.PI * 2)
    tileContext.fill()
    tileContext.restore()
    // 기포의 중심은 투명하게 남기고, 굴절광과 얇은 반사 림만 겹친다.
    const interior = tileContext.createRadialGradient(49, 42, 3, center, center, radius)
    interior.addColorStop(0, 'rgba(255,255,255,.3)')
    interior.addColorStop(.34, 'rgba(239,255,250,.09)')
    interior.addColorStop(.72, 'rgba(190,230,219,.055)')
    interior.addColorStop(1, 'rgba(255,255,255,0)')
    tileContext.fillStyle = interior
    tileContext.beginPath()
    tileContext.arc(center, center, radius, 0, Math.PI * 2)
    tileContext.fill()
    tileContext.save()
    tileContext.shadowColor = 'rgba(255,255,255,.84)'
    tileContext.shadowBlur = 7
    tileContext.strokeStyle = 'rgba(255,255,255,.78)'
    tileContext.lineWidth = 2.2
    tileContext.beginPath()
    tileContext.arc(center, center, radius * .89, -.82, Math.PI * .83)
    tileContext.stroke()
    tileContext.restore()
    const refraction = tileContext.createLinearGradient(19, 26, 109, 105)
    refraction.addColorStop(0, 'rgba(255,255,255,.88)')
    refraction.addColorStop(.28, 'rgba(211,246,255,.52)')
    refraction.addColorStop(.52, 'rgba(245,219,255,.38)')
    refraction.addColorStop(.75, 'rgba(210,255,232,.48)')
    refraction.addColorStop(1, 'rgba(255,255,255,.72)')
    tileContext.strokeStyle = refraction
    tileContext.lineWidth = 1.25
    tileContext.beginPath()
    tileContext.arc(center, center, radius * .9, .22, Math.PI * 1.73)
    tileContext.stroke()
    tileContext.save()
    tileContext.filter = 'blur(1px)'
    const shine = tileContext.createRadialGradient(45, 38, 1, 45, 38, 17)
    shine.addColorStop(0, 'rgba(255,255,255,.96)')
    shine.addColorStop(.38, 'rgba(255,255,255,.48)')
    shine.addColorStop(1, 'rgba(255,255,255,0)')
    tileContext.fillStyle = shine
    tileContext.beginPath()
    tileContext.ellipse(45, 38, 17, 10, -.55, 0, Math.PI * 2)
    tileContext.fill()
    tileContext.restore()
    // 캐시 스프라이트 안의 미세 기포라 추가 드로우 비용 없이 군집 밀도를 높인다.
    const seed = key % 12
    drawMicroBubble(19 + seed * .35, 63, 9)
    drawMicroBubble(103, 76 - seed * .18, 11)
    drawMicroBubble(32, 99, 6)
    drawMicroBubble(103 - seed * .2, 35, 6)
    drawMicroBubble(79, 108, 5)
    sprites.set(key, tile)
    return tile
  }

  function sampleMask(u: number, v: number): number {
    if (!segmentation) return 0
    const x = clamp(Math.round(u * (segmentation.width - 1)), 0, segmentation.width - 1)
    const y = clamp(Math.round(v * (segmentation.height - 1)), 0, segmentation.height - 1)
    return segmentation.confidence[y * segmentation.width + x] || 0
  }

  function maskDirection(u: number, v: number): Point {
    if (!segmentation) return { x: 0, y: -1 }
    const stepX = 1 / segmentation.width
    const stepY = 1 / segmentation.height
    const gx = sampleMask(u + stepX, v) - sampleMask(u - stepX, v)
    const gy = sampleMask(u, v + stepY) - sampleMask(u, v - stepY)
    const length = Math.hypot(gx, gy) || 1
    return { x: gx / length, y: gy / length }
  }

  function rebuildBaseBubbles(): void {
    if (!segmentation) return
    const bubbles: BaseBubble[] = []
    const cellsX = 56
    const cellsY = 44
    const cap = Math.min(420, Math.round(width * height / 3100))
    for (let row = 0; row < cellsY && bubbles.length < cap; row += 1) {
      for (let column = 0; column < cellsX && bubbles.length < cap; column += 1) {
        const u = (column + .12 + Math.random() * .76) / cellsX
        const v = (row + .12 + Math.random() * .76) / cellsY
        const confidence = sampleMask(u, v)
        if (v > segmentation.foreheadY + .026 || confidence < .46) continue
        const inward = maskDirection(u, v)
        const nearEdge = confidence < .76
        const radius = randomBetween(5, 17) * clamp(faceScale() / 180, .72, 1.35)
        bubbles.push({
          u,
          v,
          radius,
          phase: Math.random() * Math.PI * 2,
          normalX: -inward.x,
          normalY: -inward.y,
          tangentX: -inward.y,
          tangentY: inward.x,
          overflow: nearEdge ? randomBetween(radius * .08, radius * .48) : 0,
          sprite: Math.round(radius / 4) * 4,
        })
      }
    }
    baseBubbles = bubbles
  }

  function nearestLandmark(point: Point): { index: number; point: Point } | null {
    if (!facePoints.length) return null
    let best = 0
    let bestDistance = Infinity
    for (let index = 0; index < facePoints.length; index += 1) {
      const currentDistance = distance(point, facePoints[index])
      if (currentDistance < bestDistance) { best = index; bestDistance = currentDistance }
    }
    return { index: best, point: facePoints[best] }
  }

  function attachBubble(point: Point, radius: number, spread = 0): void {
    const anchor = nearestLandmark(point)
    if (!anchor) return
    const scale = faceScale()
    const basis = faceBasis()
    const deltaX = point.x - anchor.point.x + randomBetween(-spread, spread)
    const deltaY = point.y - anchor.point.y + randomBetween(-spread, spread)
    attachedBubbles.push({
      landmark: anchor.index,
      offsetX: (deltaX * basis.x + deltaY * basis.y) / scale,
      offsetY: (-deltaX * basis.y + deltaY * basis.x) / scale,
      radius,
      phase: Math.random() * Math.PI * 2,
      sprite: Math.round(radius / 4) * 4,
    })
    // 핀치·주먹 거품은 얼굴에 붙는 낙서 레이어다. 생성 순서가 오래됐다는
    // 이유로 제거하지 않으며, 카메라 예제를 나갈 때만 release()에서 정리한다.
  }

  function isFaceAttachmentArea(point: Point): boolean {
    if (!facePoints.length) return false
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const landmark of facePoints) {
      minX = Math.min(minX, landmark.x)
      maxX = Math.max(maxX, landmark.x)
      minY = Math.min(minY, landmark.y)
      maxY = Math.max(maxY, landmark.y)
    }
    const faceWidth = maxX - minX
    const faceHeight = maxY - minY
    const inFaceAndScalpBounds = point.x >= minX - faceWidth * .18
      && point.x <= maxX + faceWidth * .18
      && point.y >= minY - faceHeight * .46
      && point.y <= maxY + faceHeight * .16
    if (!inFaceAndScalpBounds) return false
    const landmark = nearestLandmark(point)
    const touchesLandmarkRegion = Boolean(landmark && distance(point, landmark.point) < faceScale() * .5)
    const videoPoint = screenToVideo(point)
    const touchesHumanSeg = Boolean(segmentation && sampleMask(videoPoint.x, videoPoint.y) > .22)
    return touchesHumanSeg || touchesLandmarkRegion
  }

  function placeFistBubble(point: Point, radius: number, spread = 0): void {
    if (isFaceAttachmentArea(point)) {
      attachBubble(point, radius, spread)
      return
    }
    // 얼굴 밖에서 만들어진 거품은 화면 좌표를 유지한다. 얼굴이 이 거품을
    // 지나가면 promoteFreeBubbles()가 attached 상태로 승격한다.
    freeBubbles.push({ x: point.x, y: point.y, radius, phase: Math.random() * Math.PI * 2, sprite: Math.round(radius / 4) * 4 })
  }

  function promoteFreeBubbles(): void {
    if (!freeBubbles.length || !facePoints.length) return
    const remaining: FreeBubble[] = []
    for (const bubble of freeBubbles) {
      if (isFaceAttachmentArea(bubble)) attachBubble(bubble, bubble.radius)
      else remaining.push(bubble)
    }
    freeBubbles = remaining
  }

  function addInterpolatedPinch(from: Point, to: Point): void {
    const count = Math.max(1, Math.ceil(distance(from, to) / 7))
    for (let index = 1; index <= count; index += 1) {
      const progress = index / count
      const point = { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
      attachBubble(point, randomBetween(5, 9))
      // 큰 기포 사이를 미세 기포가 메우는 샴푸 거품 낙서 질감.
      attachBubble({ x: point.x + randomBetween(-6, 6), y: point.y + randomBetween(-6, 6) }, randomBetween(2.5, 5))
    }
  }

  function addFistClusters(from: Point, to: Point): void {
    const count = Math.max(1, Math.ceil(distance(from, to) / 25))
    const scale = faceScale()
    for (let step = 1; step <= count; step += 1) {
      const progress = step / count
      const center = { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
      placeFistBubble(center, randomBetween(13, 23))
      const bubbles = 22
      for (let index = 0; index < bubbles; index += 1) {
        const angle = Math.random() * Math.PI * 2
        const radial = Math.pow(Math.random(), .62) * scale * .52
        placeFistBubble({ x: center.x + Math.cos(angle) * radial, y: center.y + Math.sin(angle) * radial }, randomBetween(5, 23), 2)
      }
    }
  }

  function handOnHead(point: Point): boolean {
    if (!segmentation || !facePoints.length) return false
    const videoPoint = screenToVideo(point)
    // 실루엣 판정의 근거는 항상 실제 HumanSeg confidence mask다. 그 안에서
    // FaceLandmarker의 얼굴 범위와 이마 위 두피 범위를 함께 허용해, 볼·턱
    // 가까이에서 쥔 주먹도 시작 제스처로 빠지지 않게 한다.
    if (sampleMask(videoPoint.x, videoPoint.y) <= .22) return false
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const landmark of facePoints) {
      minX = Math.min(minX, landmark.x)
      maxX = Math.max(maxX, landmark.x)
      minY = Math.min(minY, landmark.y)
      maxY = Math.max(maxY, landmark.y)
    }
    const faceWidth = maxX - minX
    const faceHeight = maxY - minY
    const inFaceOrScalp = point.x >= minX - faceWidth * .2
      && point.x <= maxX + faceWidth * .2
      && point.y >= minY - faceHeight * .48
      && point.y <= maxY + faceHeight * .16
    return inFaceOrScalp
  }

  function updateGesture(now: number): void {
    const hasHand = hand && now - hand.seenAt < 320
    if (!hasHand || !hand) {
      // 손이 빠르게 움직일 때 생기는 한두 프레임 누락은 주먹 상태를 끊지
      // 않는다. 실제로 손을 펼지 않은 채 얼굴 밖으로 옮긴 경우에도 다음
      // 검출 좌표까지 한 번에 보간할 수 있게 마지막 생성 지점을 보존한다.
      gesture = 'none'
      lastPinchPoint = null
      if (now - lastFistDetectedAt > 720) {
        lastFistPoint = null
        lastFistSpawnPoint = null
        fistStartedOnHead = false
      }
      return
    }
    // Worker가 새 랜드마크를 보낸 프레임에서만 거품을 생성한다. rAF마다
    // 같은 손 좌표를 다시 처리하면 정지한 핀치에서도 거품이 중복 생성되어
    // 캔버스 부하와 발열이 계속 증가한다.
    if (consumedHandRevision === handRevision) {
      // 주먹 거품은 새 손 결과를 기다리지 않고도 약속한 주기를 유지한다.
      if (gesture === 'fist' && fistStartedOnHead && lastFistPoint && lastFistSpawnPoint && now >= nextFistClusterAt) {
        addFistClusters(lastFistSpawnPoint, lastFistPoint)
        lastFistSpawnPoint = lastFistPoint
        nextFistClusterAt = now + randomBetween(360, 460)
      }
      return
    }
    consumedHandRevision = handRevision
    const points = hand.points
    const pinchPoint = toScreen({ x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2 })
    const fistPoint = toScreen(points[9])
    if (hand.pinch) {
      if (gesture !== 'pinch') lastPinchPoint = pinchPoint
      else if (lastPinchPoint) addInterpolatedPinch(lastPinchPoint, pinchPoint)
      gesture = 'pinch'
      lastPinchPoint = pinchPoint
      lastFistPoint = null
      lastFistSpawnPoint = null
      lastFistDetectedAt = 0
      fistStartedOnHead = false
      return
    }
    if (hand.fist) {
      if (gesture !== 'fist') {
        const continuingFist = fistStartedOnHead && now - lastFistDetectedAt < 720
        fistStartedOnHead = continuingFist || handOnHead(fistPoint)
        lastFistPoint = fistPoint
        lastFistSpawnPoint ??= fistPoint
        if (!continuingFist) nextFistClusterAt = now
      }
      gesture = 'fist'
      lastFistDetectedAt = now
      if (fistStartedOnHead && lastFistSpawnPoint && now >= nextFistClusterAt) {
        // 마지막 군집 생성 위치부터 현재 손 위치까지 쪼개서 생성하므로,
        // 주먹이 얼굴 바깥으로 빠르게 이동해도 거품 경로가 이어진다.
        addFistClusters(lastFistSpawnPoint, fistPoint)
        lastFistSpawnPoint = fistPoint
        nextFistClusterAt = now + randomBetween(360, 460)
      }
      lastFistPoint = fistPoint
      lastPinchPoint = null
      return
    }
    gesture = 'none'
    lastPinchPoint = null
    lastFistPoint = null
    lastFistSpawnPoint = null
    lastFistDetectedAt = 0
    fistStartedOnHead = false
  }

  function receiveHand(result: { landmarks: NormalizedPoint[] | null; timestamp: number }): void {
    handInFlight = false
    if (!result.landmarks?.length) return
    const points = result.landmarks
    const palm = Math.max(.035, distance(points[0], points[9]))
    const pinch = distance(points[4], points[8]) / palm < .52
    const folded = [8, 12, 16, 20].reduce((sum, index) => sum + distance(points[index], points[0]), 0) / 4 / palm
    hand = { points, pinch, fist: !pinch && folded < 1.7, seenAt: performance.now() }
    handRevision += 1
    lastGestureAt = performance.now()
  }

  function createHandWorker(): void {
    handWorker?.terminate()
    handWorkerReady = false
    handInFlight = false
    handWorker = new Worker(new URL('./shampoo-hand.worker.ts', import.meta.url), { type: 'module' })
    handWorker.onmessage = (event: MessageEvent<{ type: string; landmarks?: NormalizedPoint[] | null; timestamp?: number }>) => {
      if (event.data.type === 'ready') handWorkerReady = true
      if (event.data.type === 'result') receiveHand({ landmarks: event.data.landmarks ?? null, timestamp: event.data.timestamp ?? 0 })
      if (event.data.type === 'error') { handInFlight = false; hint.textContent = '손 인식을 다시 준비하는 중이에요' }
    }
    handWorker.postMessage({ type: 'init' })
  }

  function sendHandFrame(now: number): void {
    if (!handWorker || !handWorkerReady || handInFlight || now - lastHandFrameAt < 44 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    lastHandFrameAt = now
    handInFlight = true
    // HandLandmarker는 내부에서 작은 정사각 입력으로 재샘플링한다. 전송 전
    // 16:9 프레임을 축소하면 Worker 간 픽셀 복사량을 크게 낮추면서 정규화된
    // 랜드마크 좌표와 화면 비주얼은 그대로 유지된다.
    void createImageBitmap(video, { resizeWidth: 512, resizeHeight: 288, resizeQuality: 'low' }).catch(() => createImageBitmap(video)).then((frameBitmap) => {
      if (!handWorker) { frameBitmap.close(); handInFlight = false; return }
      handWorker.postMessage({ type: 'frame', frame: frameBitmap, timestamp: now }, [frameBitmap])
    }).catch(() => { handInFlight = false })
  }

  function updateFace(now: number): void {
    if (!faceLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || now - lastFaceAt < 66 || video.currentTime === lastVideoTime) return
    lastFaceAt = now
    lastVideoTime = video.currentTime
    const result = faceLandmarker.detectForVideo(video, now)
    const raw = result.faceLandmarks[0]
    if (raw) {
      faceRaw = raw
      facePoints = raw.map(toScreen)
      promoteFreeBubbles()
    }
  }

  function updateSegmentation(now: number): void {
    const gesturing = gesture !== 'none' && now - lastGestureAt < 220
    const cadence = gesturing ? 720 : 290
    if (!imageSegmenter || !faceRaw.length || now - lastSegmentAt < cadence || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    lastSegmentAt = now
    imageSegmenter.segmentForVideo(video, now, (result) => {
      const masks = result.confidenceMasks
      if (!masks?.length) return
      try {
        if (!faceRaw[10]) return
        const first = masks[0]
        const widthMask = first.width
        const heightMask = first.height
        const confidence = new Float32Array(widthMask * heightMask)
        for (let maskIndex = 1; maskIndex < masks.length; maskIndex += 1) {
          const values = masks[maskIndex].getAsFloat32Array()
          for (let index = 0; index < confidence.length; index += 1) confidence[index] += values[index]
        }
        if (!confidence.some((value) => value > .5)) return
        segmentation = { width: widthMask, height: heightMask, confidence, foreheadY: clamp(faceRaw[10].y, .02, .92) }
        rebuildBaseBubbles()
      } finally {
        masks.forEach((mask) => mask.close())
      }
    })
  }

  function drawBubble(x: number, y: number, radius: number, spriteKey: number): void {
    if (x + radius < 0 || x - radius > width || y + radius < 0 || y - radius > height) return
    const image = sprite(spriteKey)
    context.drawImage(image, x - radius, y - radius, radius * 2, radius * 2)
  }

  function setStatus(nextHint: string, nextDetail: string): void {
    if (shownHint !== nextHint) { hint.textContent = nextHint; shownHint = nextHint }
    if (shownDetail !== nextDetail) { detail.textContent = nextDetail; shownDetail = nextDetail }
  }

  function draw(now: number): void {
    context.clearRect(0, 0, width, height)
    if (segmentation) {
      context.globalAlpha = .94
      for (const bubble of baseBubbles) {
        const sway = Math.sin(now * .0012 + bubble.phase)
        const drift = Math.cos(now * .0016 + bubble.phase) * .9
        const u = bubble.u + bubble.normalX * (bubble.overflow + sway * 1.35) / Math.max(video.videoWidth || width, 1) + bubble.tangentX * drift / Math.max(video.videoWidth || width, 1)
        const v = bubble.v + bubble.normalY * (bubble.overflow + sway * 1.35) / Math.max(video.videoHeight || height, 1) + bubble.tangentY * drift / Math.max(video.videoHeight || height, 1)
        const point = toScreen({ x: u, y: v })
        drawBubble(point.x, point.y, bubble.radius, bubble.sprite)
      }
    }
    context.globalAlpha = 1
    const scale = faceScale()
    const basis = faceBasis()
    for (const bubble of freeBubbles) {
      const pulse = 1 + Math.sin(now * .0018 + bubble.phase) * .035
      drawBubble(bubble.x, bubble.y, bubble.radius * pulse, bubble.sprite)
    }
    for (const bubble of attachedBubbles) {
      const anchor = facePoints[bubble.landmark]
      if (!anchor) continue
      const pulse = 1 + Math.sin(now * .0018 + bubble.phase) * .035
      drawBubble(
        anchor.x + (bubble.offsetX * basis.x - bubble.offsetY * basis.y) * scale,
        anchor.y + (bubble.offsetX * basis.y + bubble.offsetY * basis.x) * scale,
        bubble.radius * pulse,
        bubble.sprite,
      )
    }
    if (!segmentation) setStatus('머리 실루엣을 인식하는 중이에요', 'HumanSeg mask loading')
    else if (gesture === 'pinch') setStatus('핀치 경로에 거품을 얹고 있어요', 'PINCH · FACE ATTACHED')
    else if (gesture === 'fist') setStatus(fistStartedOnHead ? '넓은 거품 군집을 만들고 있어요' : '얼굴 또는 두피에서 주먹을 쥐어보세요', 'FIST · RADIAL FOAM')
    else setStatus('핀치로 거품을 그리고, 얼굴 위에서 주먹을 쥐어보세요', 'SELFIE HUMANSEG · READY')
  }

  async function createModels(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks('/lemonade/wasm')
    const common = { runningMode: 'VIDEO' as const }
    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, { ...common, baseOptions: { delegate: 'GPU', modelAssetPath: '/lemonade/face_landmarker.task' }, numFaces: 1, minFaceDetectionConfidence: .55, minTrackingConfidence: .55 })
      imageSegmenter = await ImageSegmenter.createFromOptions(vision, { ...common, baseOptions: { delegate: 'GPU', modelAssetPath: '/shampoo-selfie-segmentation.tflite' }, outputConfidenceMasks: true, outputCategoryMask: false })
    } catch {
      faceLandmarker?.close(); imageSegmenter?.close()
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, { ...common, baseOptions: { delegate: 'CPU', modelAssetPath: '/lemonade/face_landmarker.task' }, numFaces: 1, minFaceDetectionConfidence: .55, minTrackingConfidence: .55 })
      imageSegmenter = await ImageSegmenter.createFromOptions(vision, { ...common, baseOptions: { delegate: 'CPU', modelAssetPath: '/shampoo-selfie-segmentation.tflite' }, outputConfidenceMasks: true, outputCategoryMask: false })
    }
    createHandWorker()
  }

  function release(): void {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    video.srcObject = null
    faceLandmarker?.close(); faceLandmarker = null
    imageSegmenter?.close(); imageSegmenter = null
    if (handWorker) { handWorker.postMessage({ type: 'shutdown' }); handWorker.terminate() }
    handWorker = null
    handWorkerReady = false
    handInFlight = false
    started = false
    segmentation = null
    baseBubbles = []
    freeBubbles = []
    facePoints = []
    faceRaw = []
    hand = null
    handRevision = 0
    consumedHandRevision = 0
    gesture = 'none'
    lastPinchPoint = null
    lastFistPoint = null
    lastFistSpawnPoint = null
    lastFistDetectedAt = 0
    fistStartedOnHead = false
  }

  async function start(): Promise<void> {
    if (starting || started || !isActive() || document.hidden) return
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { hint.textContent = '보안 연결에서 카메라를 허용해 주세요'; return }
    starting = true
    hint.textContent = '카메라와 거품 엔진을 준비하는 중이에요'
    try {
      // Balloon(08)과 같은 16:9 입력을 우선 요청한다. 4:3 입력을 cover로
      // 채우면서 생기던 확대 크롭을 방지하고, 화면 좌표 변환도 같은 기준을 쓴다.
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
      if (!isActive() || document.hidden) { release(); return }
      video.srcObject = stream
      await video.play()
      await createModels()
      if (!isActive() || document.hidden) { release(); return }
      started = true
    } catch {
      release()
      hint.textContent = '카메라 또는 HumanSeg 모델을 시작할 수 없어요'
      detail.textContent = 'CAMERA PERMISSION REQUIRED'
    } finally { starting = false }
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect()
    pixelRatio = Math.min(devicePixelRatio || 1, 1.5)
    width = Math.max(320, bounds.width)
    height = Math.max(360, bounds.height)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    if (segmentation) rebuildBaseBubbles()
  }

  function tick(now: number): void {
    const active = isActive() && !document.hidden
    if (active && !wasActive) void start()
    if (!active && wasActive) release()
    wasActive = active
    if (active && started) {
      updateFace(now)
      sendHandFrame(now)
      updateGesture(now)
      updateSegmentation(now)
      draw(now)
    }
    requestAnimationFrame(tick)
  }

  window.addEventListener('resize', resize)
  window.addEventListener('pagehide', release)
  document.addEventListener('visibilitychange', () => { if (document.hidden) release() })
  resize()
  requestAnimationFrame(tick)
  return { resize }
}
