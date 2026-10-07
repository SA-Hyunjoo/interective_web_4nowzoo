import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { registerCaptureProvider } from './capture-controller'

interface Point { x: number; y: number }
interface Hand { palm: Point; fist: boolean }
interface Lemon {
  x: number
  y: number
  homeX: number
  homeY: number
  radius: number
  phase: number
  juice: number
  held: boolean
  exhausted: boolean
  velocityY: number
  squash: number
}
interface Drop { x: number; y: number; vx: number; vy: number; amount: number; life: number }

export interface LemonadeGameController { resize: () => void }

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const lerp = (from: number, to: number, progress: number): number => from + (to - from) * progress
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export function setupLemonadeGame(container: HTMLElement, isActive: () => boolean): LemonadeGameController {
  const video = container.querySelector<HTMLVideoElement>('#lemonadeVideo')!
  const canvas = container.querySelector<HTMLCanvasElement>('#lemonadeCanvas')!
  const context = canvas.getContext('2d')!
  const lemonImage = new Image()
  let lemonSprite: CanvasImageSource | null = null
  lemonImage.addEventListener('load', () => {
    const sprite = document.createElement('canvas')
    sprite.width = lemonImage.naturalWidth
    sprite.height = lemonImage.naturalHeight
    const spriteContext = sprite.getContext('2d', { willReadFrequently: true })!
    spriteContext.drawImage(lemonImage, 0, 0)
    const pixels = spriteContext.getImageData(0, 0, sprite.width, sprite.height)
    for (let pixel = 0; pixel < pixels.data.length; pixel += 4) {
      const red = pixels.data[pixel]
      const green = pixels.data[pixel + 1]
      const blue = pixels.data[pixel + 2]
      const brightness = (red + green + blue) / 3
      const saturation = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (saturation < 28 && brightness > 125) pixels.data[pixel + 3] = 0
    }
    spriteContext.putImageData(pixels, 0, 0)
    lemonSprite = sprite
  })
  lemonImage.src = '/lemonade/lemon-1.png'

  let stream: MediaStream | null = null
  let handLandmarker: HandLandmarker | null = null
  let faceLandmarker: FaceLandmarker | null = null
  let cameraStarted = false
  let starting = false
  let attemptedForView = false
  let wasVisible = false
  let width = 1280
  let height = 720
  let lastFrame = performance.now()
  let lastDetectionAt = 0
  let lastVideoTime = -1
  let time = 0
  let leftHand: Hand | null = null
  let rightHand: Hand | null = null
  let mouth: Point | null = null
  let heldLemon: Lemon | null = null
  let lemonade = 0
  let strawActive = false
  let lemons: Lemon[] = []
  let drops: Drop[] = []
  const cup = { x: width / 2, y: height - 135, targetX: width / 2, targetY: height - 135, width: 166, height: 206 }

  registerCaptureProvider({
    isAvailable: () => isActive() && cameraStarted && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    draw: (captureContext, captureWidth, captureHeight) => {
      const sourceWidth = video.videoWidth || captureWidth
      const sourceHeight = video.videoHeight || captureHeight
      const scale = Math.max(captureWidth / sourceWidth, captureHeight / sourceHeight)
      const renderWidth = sourceWidth * scale
      const renderHeight = sourceHeight * scale
      captureContext.fillStyle = '#111'
      captureContext.fillRect(0, 0, captureWidth, captureHeight)
      captureContext.save()
      captureContext.translate(captureWidth, 0)
      captureContext.scale(-1, 1)
      captureContext.drawImage(video, (captureWidth - renderWidth) / 2, (captureHeight - renderHeight) / 2, renderWidth, renderHeight)
      captureContext.restore()
      captureContext.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, captureWidth, captureHeight)
    },
  })

  function roundedPath(x: number, y: number, boxWidth: number, boxHeight: number, radius: number): void {
    const r = Math.min(radius, boxWidth / 2, boxHeight / 2)
    context.beginPath()
    context.moveTo(x + r, y)
    context.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, r)
    context.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, r)
    context.arcTo(x, y + boxHeight, x, y, r)
    context.arcTo(x, y, x + boxWidth, y, r)
    context.closePath()
  }

  function cupPath(top: number): void {
    const bottom = top + cup.height
    const rimLeft = cup.x - cup.width * .47
    const rimRight = cup.x + cup.width * .47
    const baseLeft = cup.x - cup.width * .35
    const baseRight = cup.x + cup.width * .35
    const rimCurve = cup.width * .075
    const baseCurve = cup.width * .065
    context.beginPath()
    context.moveTo(rimLeft + rimCurve, top)
    context.lineTo(rimRight - rimCurve, top)
    context.quadraticCurveTo(rimRight, top, rimRight - cup.width * .012, top + rimCurve)
    context.lineTo(baseRight, bottom - baseCurve)
    context.quadraticCurveTo(baseRight, bottom, baseRight - baseCurve, bottom)
    context.lineTo(baseLeft + baseCurve, bottom)
    context.quadraticCurveTo(baseLeft, bottom, baseLeft, bottom - baseCurve)
    context.lineTo(rimLeft + cup.width * .012, top + rimCurve)
    context.quadraticCurveTo(rimLeft, top, rimLeft + rimCurve, top)
    context.closePath()
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

  function createLemons(): void {
    lemons = Array.from({ length: 6 }, (_, index) => {
      const radius = clamp(width * (0.05 + (index % 2) * .006), 38, 64)
      const x = width * (0.12 + (index % 3) * .35) + (index > 2 ? width * .09 : 0)
      const y = height * (.18 + Math.floor(index / 3) * .24)
      return { x, y, homeX: x, homeY: y, radius, phase: index * 1.73, juice: 1, held: false, exhausted: false, velocityY: 0, squash: 0 }
    })
  }

  function resetScene(): void {
    lemonade = 0
    strawActive = false
    heldLemon = null
    drops = []
    createLemons()
  }

  function stopCamera(): void {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    video.srcObject = null
    cameraStarted = false
    leftHand = null
    rightHand = null
    mouth = null
  }

  async function startCamera(): Promise<void> {
    if (starting || cameraStarted || attemptedForView || !isActive()) return
    attemptedForView = true
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) return
    starting = true
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
      if (!isActive()) {
        stream.getTracks().forEach((track) => track.stop())
        stream = null
        return
      }
      video.srcObject = stream
      await video.play()
      const vision = await FilesetResolver.forVisionTasks('/lemonade/wasm')
      const baseOptions = { delegate: 'GPU' as const }
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { ...baseOptions, modelAssetPath: '/lemonade/hand_landmarker.task' },
          runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.58, minTrackingConfidence: 0.55,
        })
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { ...baseOptions, modelAssetPath: '/lemonade/face_landmarker.task' },
          runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: 0.55, minTrackingConfidence: 0.55,
        })
      } catch {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/lemonade/hand_landmarker.task', delegate: 'CPU' },
          runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.58, minTrackingConfidence: 0.55,
        })
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/lemonade/face_landmarker.task', delegate: 'CPU' },
          runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: 0.55, minTrackingConfidence: 0.55,
        })
      }
      cameraStarted = true
    } catch {
      stopCamera()
    } finally {
      starting = false
    }
  }

  function detect(now: number): void {
    if (!handLandmarker || !faceLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === lastVideoTime || now - lastDetectionAt < 83) return
    lastVideoTime = video.currentTime
    lastDetectionAt = now
    leftHand = null
    rightHand = null
    const handResult = handLandmarker.detectForVideo(video, now)
    handResult.landmarks.forEach((landmarks, index) => {
      const points = landmarks.map(toScreen)
      const palm = points[9]
      const palmSize = Math.max(12, distance(points[0], palm))
      const reach = [8, 12, 16, 20].reduce((sum, point) => sum + distance(points[0], points[point]), 0) / 4
      const hand = { palm, fist: reach / palmSize < 1.72 }
      if (handResult.handedness[index]?.[0]?.categoryName === 'Left') leftHand = hand
      else rightHand = hand
    })
    const faceResult = faceLandmarker.detectForVideo(video, now)
    const landmarks = faceResult.faceLandmarks[0]
    mouth = landmarks ? toScreen(landmarks[13]) : null
  }

  function update(dt: number): void {
    const defaultX = width / 2
    const defaultY = height - cup.height * 0.58
    if (rightHand) {
      cup.targetX = rightHand.palm.x
      cup.targetY = clamp(rightHand.palm.y + cup.height * 0.22, cup.height * 0.56, height - cup.height * 0.45)
    } else {
      cup.targetX = defaultX
      cup.targetY = defaultY
    }
    cup.x = lerp(cup.x, cup.targetX, Math.min(1, dt * 9))
    cup.y = lerp(cup.y, cup.targetY, Math.min(1, dt * 9))

    if (heldLemon && (!leftHand || !leftHand.fist)) {
      heldLemon.held = false
      heldLemon.homeX = heldLemon.x
      heldLemon.homeY = heldLemon.y
      heldLemon = null
    }
    lemons.forEach((lemon) => {
      lemon.squash = Math.max(0, lemon.squash - dt * 2.6)
      if (lemon.exhausted) {
        lemon.velocityY += height * 1.35 * dt
        lemon.y += lemon.velocityY * dt
        return
      }
      if (lemon.held && leftHand) {
        lemon.x = lerp(lemon.x, leftHand.palm.x, Math.min(1, dt * 19))
        lemon.y = lerp(lemon.y, leftHand.palm.y, Math.min(1, dt * 19))
        if (leftHand.fist) {
          lemon.squash = 1
          lemon.juice = Math.max(0, lemon.juice - dt * 0.31)
          if (Math.random() < dt * 18) drops.push({ x: lemon.x, y: lemon.y + lemon.radius * 0.55, vx: (Math.random() - 0.5) * 52, vy: 90, amount: 0.027, life: 2.6 })
          if (lemon.juice === 0) {
            lemon.exhausted = true
            lemon.held = false
            lemon.velocityY = 70
            heldLemon = null
          }
        }
      } else {
        lemon.x = lemon.homeX + Math.sin(time * 0.85 + lemon.phase) * width * 0.025
        lemon.y = lemon.homeY + Math.cos(time * 1.1 + lemon.phase) * height * 0.03
      }
    })
    lemons = lemons.filter((lemon) => !lemon.exhausted || lemon.y < height + lemon.radius * 2)
    if (!heldLemon && leftHand?.fist) {
      const candidate = lemons.find((lemon) => !lemon.exhausted && distance(lemon, leftHand!.palm) < lemon.radius * 1.15)
      if (candidate) { candidate.held = true; heldLemon = candidate }
    }

    const cupLeft = cup.x - cup.width * 0.34
    const cupRight = cup.x + cup.width * 0.34
    const cupTop = cup.y - cup.height * 0.32
    const cupBottom = cup.y + cup.height * 0.38
    drops.forEach((drop) => {
      drop.vy += height * 1.14 * dt
      drop.x += drop.vx * dt
      drop.y += drop.vy * dt
      drop.life -= dt
      if (drop.x > cupLeft && drop.x < cupRight && drop.y > cupTop && drop.y < cupBottom) { lemonade = clamp(lemonade + drop.amount * 0.6, 0, 1); drop.life = 0 }
    })
    drops = drops.filter((drop) => drop.life > 0 && drop.y < height + 40)
    if (lemonade >= .98) strawActive = true
    const strawTip = { x: cup.x + cup.width * 0.36, y: cup.y - cup.height * 1.06 }
    if (strawActive && mouth && rightHand && distance(strawTip, mouth) < cup.height * .72) {
      lemonade = Math.max(0, lemonade - dt * .25)
      if (lemonade <= .02) strawActive = false
    }
  }

  function drawLemon(lemon: Lemon): void {
    const squash = lemon.held ? lemon.squash : 0
    const scaleX = 1 + squash * 0.18
    const scaleY = 1 - squash * 0.42
    context.save()
    context.translate(lemon.x, lemon.y)
    context.rotate(Math.sin(time * 1.25 + lemon.phase) * 0.14)
    context.scale(scaleX, scaleY)
    context.shadowColor = 'rgba(32,24,0,.43)'
    context.shadowBlur = 16
    context.shadowOffsetY = 8
    if (lemonSprite) context.drawImage(lemonSprite, -lemon.radius, -lemon.radius, lemon.radius * 2, lemon.radius * 2)
    else {
      const gradient = context.createRadialGradient(-lemon.radius * .26, -lemon.radius * .3, 3, 0, 0, lemon.radius)
      gradient.addColorStop(0, '#fffac3'); gradient.addColorStop(.6, '#ffe14a'); gradient.addColorStop(1, '#db9d09')
      context.fillStyle = gradient
      context.beginPath(); context.ellipse(0, 0, lemon.radius, lemon.radius * .84, .16, 0, Math.PI * 2); context.fill()
    }
    context.restore()
  }

  function drawCup(): void {
    const left = cup.x - cup.width / 2
    const top = cup.y - cup.height / 2
    const bottom = cup.y + cup.height / 2
    const liquidHeight = cup.height * .7 * lemonade
    const liquidTop = bottom - cup.height * .1 - liquidHeight

    context.save()
    context.fillStyle = 'rgba(0,0,0,.25)'
    context.filter = 'blur(8px)'
    context.beginPath(); context.ellipse(cup.x, bottom + 13, cup.width * .38, 12, 0, 0, Math.PI * 2); context.fill()
    context.filter = 'none'
    context.restore()

    context.save()
    context.shadowColor = 'rgba(0,0,0,.25)'; context.shadowBlur = 20; context.shadowOffsetY = 11
    cupPath(top)
    const glass = context.createLinearGradient(left, top, left + cup.width, bottom)
    glass.addColorStop(0, 'rgba(255,255,255,.48)')
    glass.addColorStop(.16, 'rgba(207,244,255,.17)')
    glass.addColorStop(.53, 'rgba(245,255,255,.05)')
    glass.addColorStop(.83, 'rgba(172,224,242,.25)')
    glass.addColorStop(1, 'rgba(255,255,255,.42)')
    context.fillStyle = glass; context.fill()
    context.save(); context.clip()
    const liquid = context.createLinearGradient(0, liquidTop, 0, bottom)
    liquid.addColorStop(0, '#fffcc0'); liquid.addColorStop(.16, '#fff26e'); liquid.addColorStop(.72, '#edc22a'); liquid.addColorStop(1, '#ce8e0c')
    context.fillStyle = liquid; context.fillRect(left, liquidTop, cup.width, bottom - liquidTop)
    context.fillStyle = 'rgba(255,255,224,.88)'; context.beginPath(); context.ellipse(cup.x, liquidTop, cup.width * .39, 7, 0, 0, Math.PI * 2); context.fill()

    for (let index = 0; index < 4; index += 1) {
      const iceX = cup.x + (index - 1.5) * cup.width * .14 + Math.sin(time + index) * 3
      const iceY = bottom - cup.height * (.25 + index * .1) - lemonade * cup.height * .2 + Math.cos(time * 1.7 + index) * 4
      context.save(); context.translate(iceX, iceY); context.rotate(index * .6)
      roundedPath(-15, -13, 30, 27, 9)
      const ice = context.createLinearGradient(-15, -13, 15, 14)
      ice.addColorStop(0, 'rgba(255,255,255,.96)'); ice.addColorStop(.38, 'rgba(209,243,255,.76)'); ice.addColorStop(1, 'rgba(117,192,222,.58)')
      context.fillStyle = ice; context.fill(); context.strokeStyle = 'rgba(255,255,255,.76)'; context.lineWidth = 1.5; context.stroke()
      context.fillStyle = 'rgba(255,255,255,.42)'; roundedPath(-10, -9, 15, 7, 4); context.fill(); context.restore()
    }
    context.save()
    context.translate(cup.x - cup.width * .11, bottom - cup.height * .19)
    context.rotate(-.28)
    context.fillStyle = '#ffe961'
    context.beginPath(); context.arc(0, 0, cup.width * .12, 0, Math.PI * 2); context.fill()
    context.strokeStyle = '#f5bb16'; context.lineWidth = 3; context.stroke()
    context.fillStyle = 'rgba(255,255,222,.76)'; context.beginPath(); context.arc(0, 0, cup.width * .085, 0, Math.PI * 2); context.fill()
    context.strokeStyle = '#f2c026'; context.lineWidth = 1.5
    for (let index = 0; index < 6; index += 1) { const angle = (index / 6) * Math.PI * 2; context.beginPath(); context.moveTo(0, 0); context.lineTo(Math.cos(angle) * cup.width * .078, Math.sin(angle) * cup.width * .078); context.stroke() }
    context.restore()
    for (let index = 0; index < 5; index += 1) {
      const bubbleX = cup.x + Math.sin(time * 1.8 + index * 4) * cup.width * .22
      const bubbleY = bottom - cup.height * (.14 + ((time * .12 + index * .17) % .52))
      context.beginPath(); context.arc(bubbleX, bubbleY, 2 + (index % 2), 0, Math.PI * 2)
      context.fillStyle = 'rgba(255,255,221,.45)'; context.fill()
    }
    context.restore()

    context.save()
    context.shadowBlur = 0
    cupPath(top)
    context.strokeStyle = 'rgba(244,255,255,.9)'; context.lineWidth = 3.5; context.stroke()
    context.strokeStyle = 'rgba(113,178,205,.45)'; context.lineWidth = 1.2
    context.beginPath(); context.moveTo(left + cup.width * .075, top + cup.height * .16); context.lineTo(cup.x - cup.width * .31, bottom - cup.height * .12); context.stroke()
    context.beginPath(); context.moveTo(left + cup.width * .93, top + cup.height * .17); context.lineTo(cup.x + cup.width * .29, bottom - cup.height * .13); context.stroke()
    context.strokeStyle = 'rgba(255,255,255,.82)'; context.lineWidth = 2
    context.beginPath(); context.ellipse(cup.x, top + 3, cup.width * .47, 10, 0, 0, Math.PI * 2); context.stroke()
    context.strokeStyle = 'rgba(136,204,226,.55)'; context.lineWidth = 1.3
    context.beginPath(); context.ellipse(cup.x, top + 5, cup.width * .42, 6, 0, 0, Math.PI * 2); context.stroke()
    context.strokeStyle = 'rgba(255,255,255,.56)'; context.lineWidth = 6; context.lineCap = 'round'
    context.beginPath(); context.moveTo(left + cup.width * .14, top + cup.height * .18); context.lineTo(left + cup.width * .2, top + cup.height * .49); context.stroke()
    context.strokeStyle = 'rgba(177,230,246,.54)'; context.lineWidth = 2
    context.beginPath(); context.ellipse(cup.x, bottom - 4, cup.width * .31, 5, 0, 0, Math.PI * 2); context.stroke()
    context.restore()

    if (strawActive) {
      context.save(); context.strokeStyle = '#ff8db1'; context.lineWidth = 9; context.lineCap = 'round'
      context.beginPath(); context.moveTo(cup.x + cup.width * .14, top + 12); context.lineTo(cup.x + cup.width * .16, top - cup.height * .38); context.quadraticCurveTo(cup.x + cup.width * .2, top - cup.height * .55, cup.x + cup.width * .36, top - cup.height * .56); context.stroke()
      context.strokeStyle = 'rgba(255,255,255,.62)'; context.lineWidth = 2; context.beginPath(); context.moveTo(cup.x + cup.width * .1, top + 13); context.lineTo(cup.x + cup.width * .12, top - cup.height * .35); context.stroke(); context.restore()
    }
    context.restore()
  }

  function drawDrinkingEffect(): void {
    if (!strawActive || !mouth || !rightHand) return
    const strawTip = { x: cup.x + cup.width * .36, y: cup.y - cup.height * 1.06 }
    if (distance(strawTip, mouth) >= cup.height * .72) return
    context.save()
    context.strokeStyle = 'rgba(255,241,103,.88)'; context.lineWidth = 3; context.lineCap = 'round'
    for (let index = 0; index < 5; index += 1) {
      const progress = (time * 2.6 + index / 5) % 1
      context.globalAlpha = 1 - progress
      context.beginPath(); context.moveTo(strawTip.x, strawTip.y); context.lineTo(lerp(strawTip.x, mouth.x, progress), lerp(strawTip.y, mouth.y, progress)); context.stroke()
    }
    context.globalAlpha = .88; context.fillStyle = '#fff6a5'; context.beginPath(); context.arc(mouth.x, mouth.y, 7 + Math.sin(time * 11) * 2, 0, Math.PI * 2); context.fill()
    context.restore()
  }

  function draw(): void {
    context.clearRect(0, 0, width, height)
    const shade = context.createLinearGradient(0, 0, 0, height)
    shade.addColorStop(0, 'rgba(20,51,22,.05)')
    shade.addColorStop(.75, 'rgba(13,26,8,.02)')
    shade.addColorStop(1, 'rgba(15,17,4,.35)')
    context.fillStyle = shade
    context.fillRect(0, 0, width, height)
    lemons.filter((lemon) => !lemon.held).forEach(drawLemon)
    drawCup()
    drops.forEach((drop) => {
      context.save(); context.translate(drop.x, drop.y); context.fillStyle = '#fff169'; context.shadowColor = '#ffe234'; context.shadowBlur = 8
      context.beginPath(); context.moveTo(0, -7); context.bezierCurveTo(7, -1, 7, 5, 0, 8); context.bezierCurveTo(-7, 5, -7, -1, 0, -7); context.fill(); context.restore()
    })
    lemons.filter((lemon) => lemon.held).forEach(drawLemon)
    drawDrinkingEffect()
    const vignette = context.createRadialGradient(width / 2, height / 2, height * .24, width / 2, height / 2, width * .8)
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(0,0,0,.38)')
    context.fillStyle = vignette
    context.fillRect(0, 0, width, height)
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect()
    const ratio = Math.min(devicePixelRatio || 1, 1.5)
    width = Math.max(320, bounds.width)
    height = Math.max(360, bounds.height)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    cup.width = clamp(width * .16, 122, 202)
    cup.height = cup.width * 1.24
    cup.x = cup.targetX = width / 2
    cup.y = cup.targetY = height - cup.height * .58
    resetScene()
  }

  function tick(now: number): void {
    const dt = Math.min(.04, Math.max(0, (now - lastFrame) / 1000))
    lastFrame = now
    const active = isActive() && !document.hidden
    if (active && !wasVisible) { attemptedForView = false; void startCamera() }
    if (!active && wasVisible) stopCamera()
    wasVisible = active
    if (active) { time += dt; if (cameraStarted) detect(now); update(dt); draw() }
    requestAnimationFrame(tick)
  }

  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera()
  })
  resize()
  requestAnimationFrame(tick)
  return { resize }
}
