import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { registerCaptureProvider } from './capture-controller'

interface Point {
  x: number
  y: number
}

interface TrackedTip extends Point {
  depth: number
  handIndex: number
  tipIndex: number
  seenAt: number
  pulseAt: number
}

export interface WaterTouchGameController {
  resize: () => void
}

const TIP_LANDMARKS = [4, 8, 12, 16, 20]
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))

function depthAtSurface(
  landmarks: { x: number; y: number }[],
  worldLandmarks: { z: number }[] | undefined,
  tipIndex: number,
): number {
  const palmWidth = Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y)
  const handNearness = clamp((palmWidth - .11) / .26, 0, 1)
  if (!worldLandmarks) return .16 + handNearness * .64

  const palmDepth = (worldLandmarks[0].z + worldLandmarks[5].z + worldLandmarks[17].z) / 3
  const fingertipNearness = clamp((palmDepth - worldLandmarks[tipIndex].z + .012) / .09, 0, 1)
  return clamp(.14 + handNearness * .54 + fingertipNearness * .32, .14, 1)
}

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision mediump float;

  varying vec2 vUv;
  uniform sampler2D uCamera;
  uniform sampler2D uWave;
  uniform vec2 uWaveTexel;
  uniform float uViewAspect;
  uniform float uVideoAspect;
  uniform float uTime;

  vec2 cameraUv(vec2 screenUv) {
    vec2 uv = screenUv;
    if (uVideoAspect > uViewAspect) {
      float visibleWidth = uViewAspect / uVideoAspect;
      uv.x = (uv.x - 0.5) * visibleWidth + 0.5;
    } else {
      float visibleHeight = uVideoAspect / uViewAspect;
      uv.y = (uv.y - 0.5) * visibleHeight + 0.5;
    }
    uv.x = 1.0 - uv.x;
    return uv;
  }

  void main() {
    float center = texture2D(uWave, vUv).r - 0.5;
    float left = texture2D(uWave, vUv - vec2(uWaveTexel.x, 0.0)).r - 0.5;
    float right = texture2D(uWave, vUv + vec2(uWaveTexel.x, 0.0)).r - 0.5;
    float down = texture2D(uWave, vUv - vec2(0.0, uWaveTexel.y)).r - 0.5;
    float up = texture2D(uWave, vUv + vec2(0.0, uWaveTexel.y)).r - 0.5;
    vec2 slope = vec2(left - right, down - up);

    vec2 refraction = slope * 0.19;
    vec2 baseUv = cameraUv(vUv + refraction);
    vec3 color;
    color.r = texture2D(uCamera, cameraUv(vUv + refraction * 1.08)).r;
    color.g = texture2D(uCamera, baseUv).g;
    color.b = texture2D(uCamera, cameraUv(vUv + refraction * 0.9)).b;

    float edge = clamp(length(slope) * 5.3, 0.0, 1.0);
    float crest = clamp(abs(center) * 3.8 + edge, 0.0, 1.0);
    vec3 normal = normalize(vec3(slope * 9.0, 0.7));
    float shine = pow(max(0.0, dot(normal, normalize(vec3(-0.35, 0.55, 0.76)))), 7.0);
    color += vec3(0.42, 0.8, 0.92) * shine * (0.2 + crest * 0.85);
    color += vec3(0.02, 0.11, 0.14) * crest * 0.22;
    color *= 0.96 + 0.04 * sin(uTime * 0.34);

    float vignette = smoothstep(0.9, 0.28, distance(vUv, vec2(0.5)));
    color *= 0.86 + vignette * 0.14;
    gl_FragColor = vec4(color, 1.0);
  }
`

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('shader-create-failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'shader-compile-failed'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('program-create-failed')
  const vertex = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program-link-failed')
  return program
}

function createTexture(gl: WebGLRenderingContext, filter: number): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('texture-create-failed')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

function createTipGlow(red: number, green: number, blue: number): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  const ratio = 2
  const size = 48
  sprite.width = size * ratio
  sprite.height = size * ratio
  const context = sprite.getContext('2d')!
  context.scale(ratio, ratio)
  const glow = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  glow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, .42)`)
  glow.addColorStop(.22, `rgba(${red}, ${green}, ${blue}, .13)`)
  glow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`)
  context.fillStyle = glow
  context.fillRect(0, 0, size, size)
  return sprite
}

export function setupWaterTouchGame(container: HTMLElement, isActive: () => boolean): WaterTouchGameController {
  const video = container.querySelector<HTMLVideoElement>('#waterTouchVideo')!
  const canvas = container.querySelector<HTMLCanvasElement>('#waterTouchCanvas')!
  const overlay = container.querySelector<HTMLCanvasElement>('#waterTouchOverlay')!
  const overlayContext = overlay.getContext('2d')!
  const permission = container.querySelector<HTMLElement>('#waterTouchPermission')!
  const permissionCopy = container.querySelector<HTMLElement>('#waterTouchPermissionCopy')!
  const retryButton = container.querySelector<HTMLButtonElement>('#waterTouchRetry')!
  const maybeGl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'low-power' })
  const tipGlows = [createTipGlow(174, 244, 255), createTipGlow(176, 255, 226)]

  let width = 1280
  let height = 720
  let pixelRatio = 1
  let stream: MediaStream | null = null
  let handLandmarker: HandLandmarker | null = null
  let handLandmarkerPromise: Promise<HandLandmarker> | null = null
  let cameraStarted = false
  let starting = false
  let attemptedForView = false
  let wasVisible = false
  let lastVideoTime = -1
  let lastUploadedVideoTime = -1
  let cameraTextureWidth = 0
  let cameraTextureHeight = 0
  let lastDetectionAt = 0
  let lastFrame = performance.now()
  let waveAccumulator = 0
  let simulationWidth = 180
  let simulationHeight = 102
  let currentWave = new Float32Array(simulationWidth * simulationHeight)
  let previousWave = new Float32Array(simulationWidth * simulationHeight)
  let nextWave = new Float32Array(simulationWidth * simulationHeight)
  let wavePixels = new Uint8Array(simulationWidth * simulationHeight)
  let pointerPrevious: Point | null = null
  let waveIsActive = false
  let waveTextureDirty = false
  let overlayDirtyAreas: Point[] = []
  const trackedTips = new Map<string, TrackedTip>()

  if (!maybeGl) {
    permissionCopy.textContent = '이 효과를 표시하려면 WebGL을 지원하는 최신 브라우저가 필요합니다.'
    retryButton.hidden = true
    permission.hidden = false
    return { resize: () => undefined }
  }

  const gl = maybeGl
  const program = createProgram(gl)
  const positionBuffer = gl.createBuffer()
  if (!positionBuffer) throw new Error('buffer-create-failed')
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  gl.useProgram(program)
  const positionLocation = gl.getAttribLocation(program, 'aPosition')
  gl.enableVertexAttribArray(positionLocation)
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

  const cameraTexture = createTexture(gl, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([7, 25, 31, 255]))
  const waveTexture = createTexture(gl, gl.LINEAR)
  const cameraUniform = gl.getUniformLocation(program, 'uCamera')
  const waveUniform = gl.getUniformLocation(program, 'uWave')
  const waveTexelUniform = gl.getUniformLocation(program, 'uWaveTexel')
  const viewAspectUniform = gl.getUniformLocation(program, 'uViewAspect')
  const videoAspectUniform = gl.getUniformLocation(program, 'uVideoAspect')
  const timeUniform = gl.getUniformLocation(program, 'uTime')
  gl.uniform1i(cameraUniform, 0)
  gl.uniform1i(waveUniform, 1)

  registerCaptureProvider({
    isAvailable: () => isActive() && cameraStarted,
    draw: (captureContext, captureWidth, captureHeight) => {
      renderCamera(performance.now(), true)
      captureContext.fillStyle = '#061419'
      captureContext.fillRect(0, 0, captureWidth, captureHeight)
      captureContext.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, captureWidth, captureHeight)
      captureContext.drawImage(overlay, 0, 0, overlay.width, overlay.height, 0, 0, captureWidth, captureHeight)
    },
  })

  function resetWaves(): void {
    const targetWidth = clamp(Math.round(width / 7), 130, 220)
    simulationWidth = targetWidth
    simulationHeight = clamp(Math.round(targetWidth * height / width), 74, 190)
    currentWave = new Float32Array(simulationWidth * simulationHeight)
    previousWave = new Float32Array(simulationWidth * simulationHeight)
    nextWave = new Float32Array(simulationWidth * simulationHeight)
    wavePixels = new Uint8Array(simulationWidth * simulationHeight)
    wavePixels.fill(128)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, waveTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, simulationWidth, simulationHeight, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, wavePixels)
    waveIsActive = false
    waveTextureDirty = false
  }

  function disturb(point: Point, strength: number, radius = 3.2): void {
    waveIsActive = true
    waveTextureDirty = true
    const centerX = point.x * (simulationWidth - 1)
    const centerY = point.y * (simulationHeight - 1)
    const minimumX = Math.max(1, Math.floor(centerX - radius))
    const maximumX = Math.min(simulationWidth - 2, Math.ceil(centerX + radius))
    const minimumY = Math.max(1, Math.floor(centerY - radius))
    const maximumY = Math.min(simulationHeight - 2, Math.ceil(centerY + radius))
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const distance = Math.hypot(x - centerX, y - centerY)
        if (distance > radius) continue
        const falloff = .5 + Math.cos((distance / radius) * Math.PI) * .5
        const index = y * simulationWidth + x
        currentWave[index] = clamp(currentWave[index] + strength * falloff, -1.45, 1.45)
        previousWave[index] = clamp(previousWave[index] - strength * falloff * .16, -1.45, 1.45)
      }
    }
  }

  function disturbLine(from: Point, to: Point, strength: number): void {
    const screenDistance = Math.hypot((to.x - from.x) * width, (to.y - from.y) * height)
    const steps = clamp(Math.ceil(screenDistance / 11), 1, 16)
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps
      disturb({ x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }, strength, 2.5 + Math.min(2, screenDistance / 70))
    }
  }

  function simulateWave(): void {
    nextWave.fill(0)
    let maximumEnergy = 0
    for (let y = 1; y < simulationHeight - 1; y += 1) {
      const row = y * simulationWidth
      for (let x = 1; x < simulationWidth - 1; x += 1) {
        const index = row + x
        const neighbors = currentWave[index - 1] + currentWave[index + 1] + currentWave[index - simulationWidth] + currentWave[index + simulationWidth]
        const wave = (neighbors * .5 - previousWave[index]) * .987
        nextWave[index] = wave < -1.5 ? -1.5 : wave > 1.5 ? 1.5 : wave
        const energy = Math.max(Math.abs(nextWave[index]), Math.abs(currentWave[index]))
        if (energy > maximumEnergy) maximumEnergy = energy
      }
    }
    const oldestWave = previousWave
    previousWave = currentWave
    currentWave = nextWave
    nextWave = oldestWave
    waveTextureDirty = true
    if (maximumEnergy < .0035) {
      currentWave.fill(0)
      previousWave.fill(0)
      waveIsActive = false
    }
  }

  function uploadWave(): void {
    for (let index = 0; index < currentWave.length; index += 1) {
      const wave = currentWave[index]
      const bounded = wave < -1.5 ? -1.5 : wave > 1.5 ? 1.5 : wave
      wavePixels[index] = Math.round(128 + bounded * 82)
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, waveTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, simulationWidth, simulationHeight, gl.LUMINANCE, gl.UNSIGNED_BYTE, wavePixels)
    waveTextureDirty = false
  }

  function videoPointToView(landmark: { x: number; y: number }): Point | null {
    const viewAspect = width / height
    const videoAspect = (video.videoWidth || width) / (video.videoHeight || height)
    let x = 1 - landmark.x
    let y = landmark.y
    if (videoAspect > viewAspect) {
      const visibleWidth = viewAspect / videoAspect
      x = 1 - (landmark.x - (1 - visibleWidth) / 2) / visibleWidth
    } else {
      const visibleHeight = videoAspect / viewAspect
      y = (landmark.y - (1 - visibleHeight) / 2) / visibleHeight
    }
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x, y }
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

  function stopCamera(): void {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    video.srcObject = null
    cameraStarted = false
    lastUploadedVideoTime = -1
    cameraTextureWidth = 0
    cameraTextureHeight = 0
    trackedTips.clear()
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
      await getHandLandmarker()
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
    const visibleKeys = new Set<string>()

    result.landmarks.forEach((landmarks, handIndex) => {
      const handedness = result.handedness[handIndex]?.[0]?.categoryName ?? `Hand${handIndex}`
      const worldLandmarks = result.worldLandmarks[handIndex]
      TIP_LANDMARKS.forEach((tipIndex, fingerIndex) => {
        const point = videoPointToView(landmarks[tipIndex])
        if (!point) return
        const key = `${handedness}-${fingerIndex}`
        visibleKeys.add(key)
        const previous = trackedTips.get(key)
        const targetDepth = depthAtSurface(landmarks, worldLandmarks, tipIndex)
        const depth = previous ? previous.depth * .42 + targetDepth * .58 : targetDepth
        const smoothed = previous
          ? { x: previous.x * .34 + point.x * .66, y: previous.y * .34 + point.y * .66 }
          : point

        if (!previous) {
          disturb(smoothed, .12 + depth * .92, 2.35 + depth * 2.15)
        } else {
          const movement = Math.hypot((smoothed.x - previous.x) * width, (smoothed.y - previous.y) * height)
          const depthChange = Math.abs(depth - previous.depth)
          if (movement > 1.2) {
            const movementStrength = clamp(.05 + movement / 70, .08, .7) * (.2 + depth * .9)
            disturbLine(previous, smoothed, movementStrength)
          }
          if (depthChange > .035) disturb(smoothed, (.08 + depthChange * .85) * (.25 + depth * .9), 2.1 + depth * 2.25)
          else if (now - previous.pulseAt > 720) disturb(smoothed, .045 + depth * .27, 2.1 + depth * 1.8)
        }

        trackedTips.set(key, {
          ...smoothed,
          depth,
          handIndex,
          tipIndex: fingerIndex,
          seenAt: now,
          pulseAt: !previous || now - previous.pulseAt > 720 ? now : previous.pulseAt,
        })
      })
    })

    trackedTips.forEach((tip, key) => {
      if (!visibleKeys.has(key) && now - tip.seenAt > 180) trackedTips.delete(key)
    })

  }

  function renderCamera(now: number, force = false): void {
    let cameraFrameChanged = false
    if (cameraStarted && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastUploadedVideoTime) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, cameraTexture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      if (cameraTextureWidth !== video.videoWidth || cameraTextureHeight !== video.videoHeight) {
        cameraTextureWidth = video.videoWidth
        cameraTextureHeight = video.videoHeight
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video)
      }
      lastUploadedVideoTime = video.currentTime
      cameraFrameChanged = true
    }
    if (!force && !cameraFrameChanged && !waveTextureDirty) return
    if (waveTextureDirty) uploadWave()
    gl.useProgram(program)
    gl.uniform2f(waveTexelUniform, 1 / simulationWidth, 1 / simulationHeight)
    gl.uniform1f(viewAspectUniform, width / height)
    gl.uniform1f(videoAspectUniform, (video.videoWidth || width) / (video.videoHeight || height))
    gl.uniform1f(timeUniform, now / 1000)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  function drawTrackingOverlay(now: number): void {
    overlayDirtyAreas.forEach((area) => overlayContext.clearRect(area.x - 34, area.y - 34, 68, 68))
    overlayDirtyAreas = []
    trackedTips.forEach((tip) => {
      const x = tip.x * width
      const y = tip.y * height
      overlayDirtyAreas.push({ x, y })
      const age = (now - tip.pulseAt) / 1000
      const handIndex = tip.handIndex % 2
      const handHue = handIndex === 0 ? '174, 244, 255' : '176, 255, 226'
      overlayContext.drawImage(tipGlows[handIndex], x - 24, y - 24, 48, 48)
      overlayContext.strokeStyle = `rgba(${handHue}, .48)`
      overlayContext.lineWidth = 1
      overlayContext.beginPath()
      overlayContext.ellipse(x, y, 6 + tip.tipIndex * .25, 3.5 + tip.tipIndex * .12, 0, 0, Math.PI * 2)
      overlayContext.stroke()
      const rippleProgress = (age * 1.3) % 1
      overlayContext.globalAlpha = 1 - rippleProgress
      overlayContext.beginPath()
      overlayContext.ellipse(x, y, 7 + rippleProgress * 23, 4 + rippleProgress * 14, 0, 0, Math.PI * 2)
      overlayContext.stroke()
      overlayContext.globalAlpha = 1
    })
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect()
    width = Math.max(320, bounds.width)
    height = Math.max(320, bounds.height)
    const pixelBudgetRatio = Math.sqrt(2_400_000 / Math.max(1, width * height))
    pixelRatio = Math.min(devicePixelRatio || 1, 1.6, pixelBudgetRatio)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    overlay.width = Math.round(width * pixelRatio)
    overlay.height = Math.round(height * pixelRatio)
    overlayContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    gl.viewport(0, 0, canvas.width, canvas.height)
    resetWaves()
    overlayDirtyAreas = []
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture)
    renderCamera(performance.now(), true)
  }

  function pointerPoint(event: PointerEvent): Point {
    const bounds = canvas.getBoundingClientRect()
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) }
  }

  canvas.addEventListener('pointerdown', (event) => {
    pointerPrevious = pointerPoint(event)
    disturb(pointerPrevious, .9, 4.2)
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!pointerPrevious || !canvas.hasPointerCapture(event.pointerId)) return
    const point = pointerPoint(event)
    disturbLine(pointerPrevious, point, .64)
    pointerPrevious = point
  })
  const releasePointer = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    pointerPrevious = null
  }
  canvas.addEventListener('pointerup', releasePointer)
  canvas.addEventListener('pointercancel', releasePointer)

  retryButton.addEventListener('click', () => {
    attemptedForView = false
    void startCamera()
  })

  function tick(now: number): void {
    const delta = Math.min(.04, Math.max(0, (now - lastFrame) / 1000))
    lastFrame = now
    const active = isActive() && !document.hidden
    if (active && !wasVisible) {
      attemptedForView = false
      void startCamera()
    }
    if (!active && wasVisible) stopCamera()
    wasVisible = active

    if (active) {
      if (cameraStarted) detectHands(now)
      if (waveIsActive) {
        waveAccumulator = Math.min(.05, waveAccumulator + delta)
        while (waveAccumulator >= 1 / 60) {
          simulateWave()
          waveAccumulator -= 1 / 60
        }
      } else {
        waveAccumulator = 0
      }
      renderCamera(now)
      drawTrackingOverlay(now)
    }
    requestAnimationFrame(tick)
  }

  window.addEventListener('resize', resize)
  resize()
  requestAnimationFrame(tick)
  return { resize }
}
