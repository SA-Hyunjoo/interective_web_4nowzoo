import { FaceLandmarker, HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { registerCaptureProvider } from './capture-controller'
import * as THREE from 'three'
import { createChainsawModel } from './chainsaw-model'
import { createChainsawStarter, starterHit } from './chainsaw-starter'
import { fitChainsawFace } from './chainsaw-pose'
import { createChainsawEnemies, type SawSweep } from './chainsaw-enemies'

type Point = { x: number; y: number }
export interface ChainsawController { resize: () => void }

export function setupChainsaw(root: HTMLElement, isActive: () => boolean): ChainsawController {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!
  const video = root.querySelector<HTMLVideoElement>('video')!
  const start = root.querySelector<HTMLButtonElement>('button')!
  const hint = root.querySelector<HTMLElement>('p')!
  const ctx = canvas.getContext('2d', { alpha: false })!
  // A single immutable camera frame supplies BOTH inference and the background.
  // Drawing the live video here used to put old landmarks over a newer face.
  const trackedFrame = document.createElement('canvas')
  const trackedContext = trackedFrame.getContext('2d', { alpha: false })!
  let hasTrackedFrame = false
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setClearColor(0, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 5000)
  camera.position.z = 2000
  scene.add(new THREE.HemisphereLight(0xc8e5ff, 0x513024, 2.2))
  const light = new THREE.DirectionalLight(0xffecd2, 3)
  light.position.set(-2, 4, 6); scene.add(light)
  const model = createChainsawModel()
  scene.add(model.head, ...model.arms)
  const enemySystem = createChainsawEnemies(scene)
  const sawSweeps: SawSweep[] = []
  const sweepPool: SawSweep[] = Array.from({ length: 2 }, () => ({ start:{x:0,y:0}, end:{x:0,y:0}, speed:0 }))
  const starter = createChainsawStarter()
  scene.add(starter.group)
  const starterAnchor = new THREE.Vector3(), starterCenter = new THREE.Vector3()
  const sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffbe51, emissive: 0x9c4100, roughness: .4, metalness: .5 }), 64)
  sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); sparkMesh.frustumCulled = false
  const sparkTransform = new THREE.Object3D()
  scene.add(sparkMesh)
  const bloodMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshStandardMaterial({ color: 0x990914, roughness: .3, metalness: .05 }), 96)
  bloodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); bloodMesh.frustumCulled = false
  scene.add(bloodMesh)
  const blood = Array.from({ length: 96 }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, size: 1 }))
  const orientation = new THREE.Quaternion()
  let lastFaceSeen = 0, lastHandSeen = 0, lastHandsAt = 0, lastFrame = 0, detectInterval = 66
  let frameDelta = 0
  let releaseRequired: string | null = null
  const particles = Array.from({ length: 64 }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, metal: false }))
  let width = 1, height = 1
  let stream: MediaStream | null = null
  let face: FaceLandmarker | null = null
  let hand: HandLandmarker | null = null
  let starting = false, transformed = false, active = false
  let generation = 0, lastDetect = 0, lastVideo = -1, ignition = 0
  let head: { x: number; y: number; size: number; height: number; chin: Point } | null = null
  let hands: { wrist: Point; tip: Point; pinch: Point; closed: boolean; key: string; speed: number }[] = []
  let grabbed: { key: string; origin: Point; position: Point; seenAt: number } | null = null
  let grabCooldownUntil = 0
  let audio: AudioContext | null = null
  let engine: OscillatorNode | null = null
  let motor: OscillatorNode | null = null
  let gain: GainNode | null = null
  let audioDestination: MediaStreamAudioDestinationNode | null = null
  let audioFilter: BiquadFilterNode | null = null, modulation: GainNode | null = null
  let sliceBuffer: AudioBuffer | null = null
  const effectSources = new Set<AudioBufferSourceNode>()
  const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const screen = (p: Point): Point => {
    const scale = Math.max(width / (video.videoWidth || width), height / (video.videoHeight || height))
    const w = (video.videoWidth || width) * scale, h = (video.videoHeight || height) * scale
    return { x: (width - w) / 2 + (1 - p.x) * w, y: (height - h) / 2 + p.y * h }
  }
  function silence() {
    engine?.stop(); motor?.stop(); engine?.disconnect(); motor?.disconnect(); engine = null; motor = null
    audioFilter?.disconnect(); modulation?.disconnect()
    gain?.disconnect(); gain = null
    effectSources.forEach(source => { try { source.stop() } catch { source.disconnect() } }); effectSources.clear()
  }
  function sliceSound() {
    if (!audio || !audioDestination) return
    const duration = .18
    if (!sliceBuffer) {
      sliceBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate)
      const data = sliceBuffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = (Math.random()*2-1) * Math.pow(1-i/data.length, 1.7)
    }
    const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), volume = audio.createGain()
    source.buffer = sliceBuffer; filter.type = 'bandpass'; filter.frequency.value = 720; filter.Q.value = .7
    volume.gain.setValueAtTime(.05, audio.currentTime); volume.gain.exponentialRampToValueAtTime(.001, audio.currentTime+duration)
    source.connect(filter).connect(volume); volume.connect(audio.destination); volume.connect(audioDestination)
    effectSources.add(source)
    source.addEventListener('ended', () => { effectSources.delete(source); source.disconnect(); filter.disconnect(); volume.disconnect() }, { once: true })
    source.start(); source.stop(audio.currentTime+duration)
  }
  function ignite() {
    transformed = true
    ignition = performance.now()
    particles.forEach((p, i) => {
      const origin = i < 40 ? head! : hands[i % Math.max(1, hands.length)]?.wrist ?? head!
      const angle = Math.random()*Math.PI*2, speed = 120+Math.random()*400
      Object.assign(p, { x: origin.x, y: origin.y, z: 80, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed-90, vz: (Math.random()-.5)*300, life: .3+Math.random()*.35, metal: i%3 === 0 })
    })
    starter.group.visible = false
    enemySystem.setActive(true, ignition)
    blood.forEach((p, i) => {
      const origin = i < 64 ? head! : hands[i%Math.max(1,hands.length)]?.wrist ?? head!
      const angle = Math.random()*Math.PI*2, speed = 160+Math.random()*480
      Object.assign(p, { x: origin.x, y: origin.y, z: head!.size*.8, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed-100, vz: (Math.random()-.3)*360, life: .6+Math.random()*.65, size: 2+Math.random()*5 })
    })
    hint.textContent = '변신 완료 · 다시 시작하려면 이 예제를 나갔다가 돌아오세요'
    if (!audio || !audioDestination) return
    silence()
    engine = audio.createOscillator()
    motor = audio.createOscillator()
    gain = audio.createGain()
    modulation = audio.createGain()
    engine.type = 'sawtooth'
    engine.frequency.setValueAtTime(42, audio.currentTime)
    engine.frequency.exponentialRampToValueAtTime(155, audio.currentTime + .4)
    engine.frequency.exponentialRampToValueAtTime(85, audio.currentTime + 1.2)
    motor.frequency.value = 32
    modulation.gain.value = 38
    motor.connect(modulation).connect(engine.frequency)
    gain.gain.setValueAtTime(0, audio.currentTime)
    gain.gain.linearRampToValueAtTime(.045, audio.currentTime + .03)
    gain.gain.linearRampToValueAtTime(.027, audio.currentTime + .7)
    audioFilter = audio.createBiquadFilter()
    audioFilter.type = 'lowpass'; audioFilter.frequency.value = 1900
    engine.connect(audioFilter).connect(gain)
    gain.connect(audio.destination); gain.connect(audioDestination)
    engine.start(); motor.start()
  }
  function stop() {
    generation++
    stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null
    silence(); void audio?.suspend()
    transformed = false; head = null; hands = []; grabbed = null
    hasTrackedFrame = false; releaseRequired = null; lastVideo = -1
    particles.forEach(p => { p.life = 0 })
    blood.forEach(p => { p.life = 0 }); starter.group.visible = true
    enemySystem.reset(); sawSweeps.length = 0; lastHandsAt = 0
    start.hidden = false
    start.textContent = 'chainsaw man · 카메라와 사운드 시작'
  }
  start.addEventListener('click', async () => {
    if (starting) return
    starting = true; start.disabled = true
    const token = ++generation
    try {
      audio ??= new AudioContext()
      audioDestination ??= audio.createMediaStreamDestination()
      await audio.resume()
      start.textContent = '카메라와 추적 모델 준비 중…'
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } }, audio: false })
      if (token !== generation || !isActive() || document.hidden) { next.getTracks().forEach(t => t.stop()); return }
      stream = next; video.srcObject = next; await video.play()
      const vision = await FilesetResolver.forVisionTasks('/lemonade/wasm')
      if (!face) face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/lemonade/face_landmarker.task', delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1,
      })
      if (!hand) hand = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/lemonade/hand_landmarker.task', delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 2,
      })
      if (token !== generation || !isActive() || document.hidden) { stop(); return }
      start.hidden = true
      hint.textContent = '머리 위 주황색 고리 주변을 핀치로 잡고 아래로 당기세요'
    } catch {
      stop()
      start.textContent = '카메라 권한 확인 후 다시 시작'
    } finally { starting = false; start.disabled = false }
  })
  function detect(now: number) {
    if (!hand || !face || video.readyState < 2 || now - lastDetect < detectInterval || video.currentTime === lastVideo) return
    const detectStart = performance.now()
    lastDetect = now; lastVideo = video.currentTime
    if (trackedFrame.width !== video.videoWidth || trackedFrame.height !== video.videoHeight) {
      trackedFrame.width = video.videoWidth; trackedFrame.height = video.videoHeight
    }
    trackedContext.drawImage(video, 0, 0)
    hasTrackedFrame = true
    const f = face.detectForVideo(trackedFrame, now).faceLandmarks[0]
    if (f) {
      const pose = fitChainsawFace(f, width, height, video.videoWidth, video.videoHeight)
      orientation.copy(pose.rotation)
      head = pose
      lastFaceSeen = now
    } else if (now-lastFaceSeen > 650) { head = null; grabbed = null }
    const result = hand.detectForVideo(trackedFrame, now)
    const handElapsed = Math.max(16, now-lastHandsAt)
    const nextHands = result.landmarks.map((points, i) => {
      const thumb = screen(points[4]), tip = screen(points[8]), wrist = screen(points[0])
      const palm = Math.max(24, length(wrist, screen(points[9])))
      const key = result.handedness[i]?.[0]?.categoryName ?? String(i)
      // A wider release threshold prevents pinch jitter from dropping the ring.
      const wasClosed = hands.find(h => h.key === key)?.closed ?? false
      const previous = hands.find(h => h.key === key)
      const smooth = (p: Point, old?: Point): Point => old ? { x: old.x+(p.x-old.x)*.7, y: old.y+(p.y-old.y)*.7 } : p
      const nextWrist = smooth(wrist, previous?.wrist), nextTip = smooth(tip, previous?.tip)
      return { wrist: nextWrist, tip: nextTip, pinch: smooth({ x: (thumb.x + tip.x) / 2, y: (thumb.y + tip.y) / 2 }, previous?.pinch),
        closed: length(thumb, tip) < palm * (wasClosed ? .95 : .75), key,
        speed: previous ? length(nextTip, previous.tip)*1000/handElapsed : 0 }
    })
    lastHandsAt = now
    if (nextHands.length) { hands = nextHands; lastHandSeen = now }
    else if (now-lastHandSeen > 160) hands = []
    if (releaseRequired && nextHands.some(h => h.key === releaseRequired && !h.closed)) releaseRequired = null
    // Bound synchronous inference cost on slower devices; render loop remains independent.
    detectInterval = Math.max(40, Math.min(100, detectInterval*.85+(performance.now()-detectStart)*2*.15))
  }
  function draw(now: number) {
    ctx.fillStyle = '#111318'; ctx.fillRect(0, 0, width, height)
    if (hasTrackedFrame) {
      const scale = Math.max(width / trackedFrame.width, height / trackedFrame.height)
      ctx.save(); ctx.translate(width, 0); ctx.scale(-1, 1)
      ctx.drawImage(trackedFrame, (width - trackedFrame.width * scale) / 2, (height - trackedFrame.height * scale) / 2, trackedFrame.width * scale, trackedFrame.height * scale)
      ctx.restore()
    }
    if (!head) return
    model.head.visible = false; model.arms.forEach(arm => { arm.visible = false })
    const radius = Math.max(48, Math.min(68, head.size*.34))
    starterAnchor.set(0, .85, .55).applyQuaternion(orientation).multiplyScalar(head.size)
    starterAnchor.x += head.x-width/2; starterAnchor.y += height/2-head.y
    starterCenter.set(0, 1.55, .7).applyQuaternion(orientation).multiplyScalar(head.size)
    starterCenter.x += head.x-width/2; starterCenter.y += height/2-head.y
    starterCenter.z = Math.max(head.size*.9, starterCenter.z)
    // Clamp the projected handle below the navigation and inside the viewport.
    starterCenter.x = THREE.MathUtils.clamp(starterCenter.x, -width/2+radius+16, width/2-radius-16)
    starterCenter.y = THREE.MathUtils.clamp(starterCenter.y, -height/2+radius+100, height/2-radius-74)
    const restingHandle = { x: starterCenter.x+width/2, y: height/2-starterCenter.y }
    const hitRadius = starter.update(starterAnchor, starterCenter, radius, orientation, false)
    const handle = { ...restingHandle }
    if (!transformed && grabbed) {
      const holder = now-lastHandSeen < 180 && now-lastFaceSeen < 600 ? hands.find(h => h.key === grabbed!.key && h.closed) : undefined
      if (!holder) {
        // Brief tracking losses should not interrupt a pull.
        if (now - grabbed.seenAt > 300) grabbed = null
        else { handle.x = grabbed.position.x; handle.y = grabbed.position.y }
      }
      else {
        grabbed.seenAt = now
        grabbed.position = { ...holder.pinch }
        handle.x = holder.pinch.x; handle.y = holder.pinch.y
        if (holder.pinch.y - grabbed.origin.y > Math.max(28, Math.min(45, head.size * .2))) {
          releaseRequired = holder.key
          grabbed = null
          grabCooldownUntil = now + 900
          ignite()
        }
      }
    } else if (!transformed) {
      const holder = now >= grabCooldownUntil && now-lastFaceSeen < 400 && now-lastHandSeen < 180 && hands.find(h => h.closed && h.key !== releaseRequired && starterHit(h.pinch, handle, hitRadius))
      if (holder) {
        grabbed = { key: holder.key, origin: { ...holder.pinch }, position: { ...holder.pinch }, seenAt: now }
        handle.x = holder.pinch.x; handle.y = holder.pinch.y
      }
    }
    starterCenter.set(handle.x-width/2, height/2-handle.y, starterCenter.z)
    starter.update(starterAnchor, starterCenter, radius, orientation, !!grabbed)
    starter.group.visible = !transformed
    const progress = transformed ? Math.min(1, (now-ignition)/500) : 0
    const grow = 1-Math.pow(1-progress, 3)
    model.head.visible = transformed
    model.head.position.set(head.x-width/2, height/2-head.y, 0)
    model.head.quaternion.copy(orientation)
    // Keep the registered face silhouette stable throughout ignition.
    model.head.scale.set(head.size, head.height, head.size)
    model.arms.forEach((arm, i) => {
      const h = hands[i]
      arm.visible = transformed && !!h
      if (!h) return
      arm.position.set(h.wrist.x-width/2, height/2-h.wrist.y, 50)
      arm.rotation.set(0, Math.sin(now*.015+i)*.025, Math.atan2(-(h.tip.y-h.wrist.y), h.tip.x-h.wrist.x)-Math.PI/2)
      arm.scale.setScalar(Math.max(40, length(h.wrist,h.tip)*.72)*grow)
    })
    sawSweeps.length = 0
    if (transformed) for (let i = 0; i < hands.length; i++) {
      const h = hands[i], dx = h.tip.x-h.wrist.x, dy = h.tip.y-h.wrist.y, handLength = Math.max(1, Math.hypot(dx,dy))
      const bladeLength = Math.max(40, handLength*.72)*2.5*grow
      const sweep = sweepPool[i]
      sweep.start.x=h.wrist.x;sweep.start.y=h.wrist.y;sweep.end.x=h.wrist.x+dx/handLength*bladeLength;sweep.end.y=h.wrist.y+dy/handLength*bladeLength;sweep.speed=h.speed
      sawSweeps.push(sweep)
    }
    enemySystem.update(now, frameDelta, width, height, sawSweeps, sliceSound)
    if (transformed) model.animate(now)
    sparkMesh.count = 0
    for (const p of particles) {
      if (!transformed || p.life <= 0) continue
      p.life -= frameDelta
      p.x += p.vx*frameDelta; p.y += p.vy*frameDelta; p.z += p.vz*frameDelta; p.vy += 540*frameDelta
      sparkTransform.position.set(p.x-width/2, height/2-p.y, p.z)
      sparkTransform.rotation.set(now*.009+p.vz, now*.007, Math.atan2(-p.vy,p.vx))
      const fade = Math.max(0, Math.min(1, p.life*5))
      sparkTransform.scale.set((p.metal ? 6 : 12)*fade, 2*fade, (p.metal ? 4 : 2)*fade)
      sparkTransform.updateMatrix()
      sparkMesh.setMatrixAt(sparkMesh.count++, sparkTransform.matrix)
    }
    sparkMesh.instanceMatrix.needsUpdate = true
    bloodMesh.count = 0
    for (const p of blood) {
      if (!transformed || p.life <= 0) continue
      p.life -= frameDelta
      p.x += p.vx*frameDelta; p.y += p.vy*frameDelta; p.z += p.vz*frameDelta; p.vy += 680*frameDelta
      sparkTransform.position.set(p.x-width/2, height/2-p.y, p.z)
      sparkTransform.rotation.set(0, 0, Math.atan2(-p.vy,p.vx))
      const s = p.size*Math.max(0,Math.min(1,p.life*4))
      sparkTransform.scale.set(s*2.2,s,s*.7); sparkTransform.updateMatrix()
      bloodMesh.setMatrixAt(bloodMesh.count++, sparkTransform.matrix)
    }
    bloodMesh.instanceMatrix.needsUpdate = true
    renderer.render(scene, camera)
    ctx.save()
    ctx.globalAlpha = Math.min(1, Math.max(0, (650-(now-lastFaceSeen))/250))
    ctx.drawImage(renderer.domElement,0,0,width,height)
    ctx.restore()
  }
  registerCaptureProvider({
    isAvailable: () => isActive() && !!stream,
    audioStream: () => audioDestination?.stream ?? null,
    draw: (target, w, h) => { target.drawImage(canvas, 0, 0, w, h) },
  })
  function resize() {
    lastVideo = -1; hasTrackedFrame = false; head = null
    width = Math.max(1, root.clientWidth); height = Math.max(1, root.clientHeight)
    const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(1_800_000/(width*height)))
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    renderer.setPixelRatio(Math.min(ratio, 1280/width))
    renderer.setSize(width, height, false)
    camera.left = -width/2; camera.right = width/2; camera.top = height/2; camera.bottom = -height/2
    camera.updateProjectionMatrix()
  }
  function tick(now: number) {
    const visible = isActive() && !document.hidden
    if (active && !visible) stop()
    active = visible
    if (visible && now-lastFrame >= 1000/30) {
      frameDelta = Math.min(.05, (now-lastFrame)/1000); lastFrame = now
      if (stream && !starting) {
        try { detect(now) } catch { stop(); hint.textContent = '추적을 다시 시작해 주세요' }
      }
      draw(now)
    }
    requestAnimationFrame(tick)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop() })
  window.addEventListener('pagehide', stop)
  new MutationObserver(() => { if (!isActive()) stop() }).observe(root, { attributes: true, attributeFilter: ['hidden'] })
  window.addEventListener('resize', resize)
  resize(); requestAnimationFrame(tick)
  return { resize }
}
