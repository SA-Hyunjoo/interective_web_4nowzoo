import './doodleface.css'
import { registerCaptureProvider } from './capture-controller'
import { createDoodleModels } from './doodleface-vision'
import type { DoodleModels } from './doodleface-vision'
import { COLORS, TIMING, Drawing, Pinch, Round, coverTransform, localPoint, makePose, playerFor, predictPose, resolveAnchor, toPanel } from './doodleface-core'
import type { Cover, Player, Point, Pose } from './doodleface-core'

export interface DoodleFaceController { resize: () => void; dispose: () => void }
const names = ['차콜', '화이트', '코랄', '오렌지', '옐로', '그린', '민트', '블루', '퍼플', '핑크']
const faceGraphic = (second = false) => `<svg viewBox="0 0 220 240" fill="none" aria-hidden="true"><path d="M55 81C39 18 181 8 174 89L182 146C184 226 51 227 42 148Z" fill="${second ? '#c5c5ed' : '#f5c274'}" stroke="currentColor" stroke-width="4"/><path d="M61 63Q94 15 162 64M69 103l18 3m43 0 18-3m-41 12-8 30 17 3m-36 20q26 25 53-4" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="${second ? 'M54 102q31-31 47 3m22-1q25-32 44-5M81 182l56-35' : 'M59 128l26 12m-24 0 22-15M137 125l23 16m-23-1 24-15M77 159q12-25 31 0 18-25 32-2'}" stroke="${second ? '#ff5263' : '#5689ef'}" stroke-width="7" stroke-linecap="round"/></svg>`

export function setupDoodleFace(container: HTMLElement): DoodleFaceController {
  container.innerHTML = `<main class="df-shell" data-phase="lobby">
    <header class="df-hud"><a class="df-wordmark" href="#doodleface" aria-label="DoodleFace">Doodle<span>Face</span><i>✳</i></a><div class="df-session">ONE CAMERA. TWO TROUBLEMAKERS.</div><div class="df-clock"><span>TIME LEFT</span><strong>01:00</strong></div></header>
    <div class="df-intro"><span class="df-kicker">A LITTLE FRIENDLY VANDALISM</span><h1>친구 얼굴이<br class="df-mobile-break"> 나의 <em>스케치북.</em><svg viewBox="0 0 160 15" aria-hidden="true"><path d="M3 10Q74 1 156 7M24 14l114-3"/></svg></h1><p>나란히 앉아, 서로의 얼굴에 장난을 그려요.</p></div>
    <section class="df-board" aria-label="두 플레이어 화면">${[0, 1].map((i) => `<article class="df-panel" data-player="${i}"><div class="df-panel-hud"><strong>PLAYER ${i + 1}</strong><span class="df-target">${i === 0 ? '왼쪽' : '오른쪽'}에 앉아 주세요</span><i>↗</i></div><div class="df-palette" role="group" aria-label="PLAYER ${i + 1} 색상">${COLORS.map((color, c) => `<button type="button" style="--ink:${color}" data-color="${c}" aria-label="${names[c]}" aria-pressed="${c === (i ? 7 : 2)}"></button>`).join('')}</div><div class="df-viewport"><canvas class="df-camera" aria-label="PLAYER ${i + 1} 카메라와 낙서"></canvas><div class="df-placeholder">${faceGraphic(i === 1)}<span>${i === 0 ? 'YOUR FRIEND’S NEXT MASTERPIECE' : 'LOOKING GOOD. FOR NOW.'}</span></div><span class="df-wait" hidden>◌ WAITING</span><span class="df-face-label" hidden>PLAYER ${i + 1}</span></div><footer><span>✎ <b>PLAYER ${i + 1}</b>의 연필</span><span>PINCH TO DRAW</span></footer></article>`).join('')}<div class="df-vs" aria-hidden="true">↔</div></section>
    <div class="df-actions"><button class="df-start" type="button">2인 게임 시작 ＋</button><button class="df-help" type="button">게임 방법 ?</button></div>
    <div class="df-bottom"><span>두 사람 · 카메라 하나 · 60초</span><span>MADE TO MAKE YOU LAUGH <b>☺</b></span></div>
    <p class="df-notice" role="status" aria-live="polite" hidden></p><div class="df-countdown" hidden><span>서로의 얼굴을 바꿀게요</span><strong>5</strong></div>
    <button class="df-exit" type="button" hidden>게임 그만하기 ×</button>
    <dialog class="df-rules"><button class="df-close" type="button" aria-label="게임 방법 닫기">×</button><span class="df-kicker">HOW TO DOODLE</span><h2>얼굴은 친구에게.<br>연필은 내 손에.</h2><ol><li>한 카메라 앞에 나란히 앉아요. 거울 화면의 왼쪽은 PLAYER 1, 오른쪽은 PLAYER 2예요.</li><li>얼굴이 인식되면 5초 후 두 화면이 자리를 바꿔요. 모바일에서는 위아래로 바뀌어요.</li><li>내 손을 움직여 상대 화면의 연필을 조작해요. 엄지·검지를 맞대면(Pinch) 그려져요.</li><li>상대 얼굴 안에서 Pinch를 시작해요. 색상 위에서 Pinch하거나 클릭하면 내 연필 색이 바뀌어요.</li><li>60초 동안 마음껏 그려요. 완성된 얼굴은 잠시 감상한 뒤 자동으로 돌아와요.</li></ol><p>영상은 이 브라우저 안에서만 처리해요.</p></dialog>
    <video muted playsinline hidden></video></main>`
  const get = <T extends Element>(selector: string) => container.querySelector<T>(selector)!
  const shell = get<HTMLElement>('.df-shell'), board = get<HTMLElement>('.df-board')
  const video = get<HTMLVideoElement>('video'), start = get<HTMLButtonElement>('.df-start')
  const notice = get<HTMLElement>('.df-notice'), countdown = get<HTMLElement>('.df-countdown')
  const clock = get<HTMLElement>('.df-clock strong'), rules = get<HTMLDialogElement>('dialog')
  const canvases = [...container.querySelectorAll<HTMLCanvasElement>('.df-camera')]
  const contexts = canvases.map(c => c.getContext('2d')!)
  const panels = [...container.querySelectorAll<HTMLElement>('.df-panel')]
  const waits = [...container.querySelectorAll<HTMLElement>('.df-wait')]
  const labels = [...container.querySelectorAll<HTMLElement>('.df-face-label')]
  const palettes = panels.map(panel => [...panel.querySelectorAll<HTMLButtonElement>('[data-color]')])
  const input = document.createElement('canvas'), inputContext = input.getContext('2d')!
  let round = new Round(), gestures = [new Pinch(), new Pinch()], drawings = [new Drawing(), new Drawing()]
  let colors = [2, 7], faces: (Pose | null)[] = [null, null], previous: (Pose | null)[] = [null, null]
  let stream: MediaStream | null = null, models: DoodleModels | null = null, abort: AbortController | null = null
  let raf = 0, disposed = false, swapped = false, revision = 0
  let lastRender = -Infinity, lastDetect = -Infinity, lastVideo = -1, inferenceIndex = 0, slowFrames = 0
  let low = navigator.hardwareConcurrency <= 4 || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4
  let animations: Animation[] = [], layers: HTMLCanvasElement[] = []
  let layouts: { rect: DOMRect; transform: Cover; colors: DOMRect[] }[] = []
  const events = new AbortController()
  const listen = (el: EventTarget, type: string, fn: EventListener) => el.addEventListener(type, fn, { signal: events.signal })
  const message = (text: string) => { notice.textContent = text; notice.hidden = !text }

  function choose(player: number, color: number) {
    colors[player] = color
    palettes[player].forEach((b, i) => b.setAttribute('aria-pressed', String(i === color)))
  }
  palettes.forEach((palette, i) => palette.forEach((button, c) => listen(button, 'click', () => choose(i, c))))
  listen(get('.df-help'), 'click', () => rules.showModal())
  listen(get('.df-close'), 'click', () => rules.close())
  listen(rules, 'click', event => { if (event.target === rules) rules.close() })

  function measure() {
    // Exactly one layout read per panel and palette swatch per rendered frame; never per stroke point.
    layouts = canvases.map((canvas, i) => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, low ? 1 : 1.5)
      const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      contexts[i].setTransform(w / Math.max(1, rect.width), 0, 0, h / Math.max(1, rect.height), 0, 0)
      return { rect, transform: coverTransform(rect.width, rect.height, video.videoWidth || 960, video.videoHeight || 540), colors: palettes[i].map(b => b.getBoundingClientRect()) }
    })
  }
  function freshPose(player: number, now: number) {
    const face = faces[player]
    return face && now - face.at < 350 ? predictPose(face, previous[player], now) : null
  }
  function stop() {
    revision++; abort?.abort(); abort = null
    cancelAnimationFrame(raf); raf = 0
    animations.forEach(a => a.cancel()); animations = []
    layers.forEach(l => l.remove()); layers = []
    stream?.getTracks().forEach(track => track.stop()); stream = null
    video.pause(); video.srcObject = null
    try { models?.close() } finally { models = null }
    round = new Round(); faces = [null, null]; previous = [null, null]
    gestures = [new Pinch(), new Pinch()]; drawings = [new Drawing(), new Drawing()]
    swapped = false; lastVideo = -1; lastDetect = -Infinity; lastRender = -Infinity; inferenceIndex = 0; slowFrames = 0
    colors = [2, 7]; choose(0, 2); choose(1, 7)
    contexts.forEach((ctx, i) => { ctx.resetTransform(); ctx.clearRect(0, 0, canvases[i].width, canvases[i].height) })
    shell.dataset.phase = 'lobby'; start.disabled = false; start.textContent = '2인 게임 시작 ＋'
    countdown.hidden = true; clock.textContent = '01:00'; message('')
    waits.forEach(w => w.hidden = true); labels.forEach(l => l.hidden = true)
    get<HTMLElement>('.df-exit').hidden = true
    panels.forEach((p, i) => p.querySelector('.df-target')!.textContent = `${i ? '오른쪽' : '왼쪽'}에 앉아 주세요`)
  }
  function fail(error: unknown, stage: 'camera' | 'model') {
    if (disposed) return
    stop()
    const name = error instanceof Error ? error.name : ''
    message(stage === 'model' ? '인식 모델을 불러오지 못했어요. 다시 시작해 주세요.' : name === 'NotAllowedError' ? '카메라 권한을 허용한 뒤 다시 시작해 주세요.' : name === 'NotFoundError' ? '연결된 카메라가 없어요. 연결 후 다시 시작해 주세요.' : '카메라를 열지 못했어요. 다른 앱을 닫고 다시 시작해 주세요.')
  }
  async function begin() {
    if (round.phase !== 'lobby' || disposed) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { message('카메라는 localhost 또는 HTTPS에서 사용할 수 있어요.'); return }
    round.enter('loading', performance.now()); shell.dataset.phase = 'loading'; start.disabled = true
    message('카메라와 연필을 준비하고 있어요…')
    const id = ++revision, controller = new AbortController(); abort = controller
    let stage: 'camera' | 'model' = 'camera'
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: low ? 640 : 960 }, height: { ideal: low ? 360 : 540 }, frameRate: { ideal: low ? 20 : 30, max: low ? 20 : 30 } } })
      if (id !== revision) { acquired.getTracks().forEach(track => track.stop()); return }
      stream = acquired; video.srcObject = acquired
      acquired.getVideoTracks().forEach(track => listen(track, 'ended', () => { if (stream === acquired) fail(new Error('Camera ended'), 'camera') }))
      await video.play()
      if (id !== revision) return
      get<HTMLElement>('.df-exit').hidden = false
      raf = requestAnimationFrame(frame)
      stage = 'model'
      const loaded = await createDoodleModels(controller.signal)
      if (id !== revision) { loaded.close(); return }
      models = loaded; round.enter('waiting', performance.now()); message('나란히 앉아 양쪽 화면에 얼굴을 보여주세요')
    } catch (error) { if (id === revision && !controller.signal.aborted) fail(error, stage) }
  }
  listen(start, 'click', () => { void begin() })
  listen(get('.df-exit'), 'click', stop)
  listen(window, 'pagehide', stop)

  function detect(now: number) {
    if (!models || video.readyState < 2 || video.currentTime === lastVideo || now - lastDetect < (low ? 65 : 30)) return false
    lastVideo = video.currentTime; lastDetect = now
    const width = low ? 480 : 640, height = Math.round(width * video.videoHeight / video.videoWidth)
    if (input.width !== width || input.height !== height) { input.width = width; input.height = height }
    inputContext.drawImage(video, 0, 0, width, height)
    const playing = round.phase === 'playing'
    const cycle = gestures.some(g => g.down) ? 3 : 2
    const handTurn = playing && inferenceIndex++ % cycle !== 0
    const before = performance.now()
    if (handTurn) {
      const result = models.hand.detectForVideo(input, now)
      const seen: (Point[] | null)[] = [null, null]
      for (const points of result.landmarks) {
        const side = playerFor([points[0], points[5], points[9], points[13], points[17]])
        // Keep the first hand on a side: result ordering never decides player ownership.
        seen[side] ??= points
      }
      seen.forEach((points, i) => {
        const gesture = gestures[i]
        let tip: Point | null = null, ratio = 1
        if (points) {
          tip = localPoint({ x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2 }, i as Player)
          const aspect = video.videoWidth / video.videoHeight
          const distance = (a: Point, b: Point) => Math.hypot((a.x - b.x) * aspect, a.y - b.y)
          ratio = distance(points[4], points[8]) / Math.max(.001, distance(points[5], points[17]))
        }
        const event = gesture.update(tip, ratio, now)
        if (event.ended) drawings[i].end()
        if (!tip || !gesture.down) return
        const panelPoint = toPanel(tip, layouts[i].transform), rect = layouts[i].rect
        const swatch = layouts[i].colors.findIndex(r => panelPoint.x + rect.left >= r.left && panelPoint.x + rect.left <= r.right && panelPoint.y + rect.top >= r.top && panelPoint.y + rect.top <= r.bottom)
        const target = freshPose(1 - i, now)
        if (event.started) {
          if (swatch >= 0) { choose(i, swatch); drawings[i].end() }
          else drawings[i].start(tip, target, COLORS[colors[i]])
        } else if (drawings[i].active) drawings[i].append(tip, target)
      })
    } else {
      const result = models.face.detectForVideo(input, now), seen = [false, false]
      for (const points of result.faceLandmarks) {
        const side = playerFor(points)
        if (seen[side]) continue
        seen[side] = true; previous[side] = faces[side]
        faces[side] = makePose(points.map(p => localPoint(p, side)), now, video.videoWidth / 2 / video.videoHeight)
      }
      // An explicit missing result is not a stable detection (nor a drawable ghost face).
      seen.forEach((present, i) => { if (!present) { faces[i] = null; previous[i] = null } })
    }
    if (!low && performance.now() - before > 40 && ++slowFrames >= 12) {
      low = true
      void stream?.getVideoTracks()[0]?.applyConstraints({ frameRate: { ideal: 20, max: 20 }, width: { ideal: 640 }, height: { ideal: 360 } }).catch(() => {})
    }
    return true
  }
  function pencil(ctx: CanvasRenderingContext2D, p: Point, color: string, down: boolean) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(.6)
    ctx.lineWidth = 2; ctx.strokeStyle = '#25242b'
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8, -17); ctx.lineTo(-8, -67); ctx.quadraticCurveTo(0, -77, 8, -67); ctx.lineTo(8, -17); ctx.closePath()
    ctx.fillStyle = color; ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8, -17); ctx.lineTo(8, -17); ctx.closePath(); ctx.fillStyle = '#ffe0ab'; ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-3, -7); ctx.lineTo(3, -7); ctx.closePath(); ctx.fillStyle = '#25242b'; ctx.fill()
    ctx.beginPath(); ctx.moveTo(-8, -57); ctx.lineTo(8, -57); ctx.stroke(); ctx.restore()
    if (down) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill() }
  }
  function paint(now: number) {
    canvases.forEach((_, i) => {
      const ctx = contexts[i], { rect, transform: t } = layouts[i], side = swapped ? 1 - i : i
      ctx.clearRect(0, 0, rect.width, rect.height)
      if (video.readyState >= 2) {
        ctx.save(); ctx.translate(rect.width, 0); ctx.scale(-1, 1)
        // Crop the ORIGINAL exact half before cover: mirrored-left player is source-right.
        ctx.drawImage(video, (1 - side) * video.videoWidth / 2, 0, video.videoWidth / 2, video.videoHeight, t.x, t.y, t.w, t.h); ctx.restore()
      }
      const pose = freshPose(side, now)
      waits[i].hidden = !!pose || round.phase === 'lobby'
      labels[i].hidden = round.phase === 'lobby'; labels[i].textContent = `PLAYER ${side + 1}`
      if (swapped && pose) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, t.h * pose.scale * .014)
        for (const stroke of drawings[i].strokes) {
          ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color; ctx.beginPath()
          stroke.points.forEach((anchor, index) => {
            const p = toPanel(resolveAnchor(anchor, pose), t)
            if (!index) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y)
          })
          ctx.stroke()
          if (stroke.points.length === 1) { const p = toPanel(resolveAnchor(stroke.points[0], pose), t); ctx.beginPath(); ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill() }
        }
      }
      if (round.phase === 'playing' && gestures[i].point) pencil(ctx, toPanel(gestures[i].point!, t), COLORS[colors[i]], gestures[i].down)
    })
  }
  function swap() {
    const id = revision, boardRect = board.getBoundingClientRect()
    layers = canvases.map((canvas, i) => {
      const layer = document.createElement('canvas'), r = layouts[i].rect, other = layouts[1 - i].rect
      layer.className = 'df-swap-layer'; layer.width = canvas.width; layer.height = canvas.height
      layer.getContext('2d')!.drawImage(canvas, 0, 0)
      Object.assign(layer.style, { left: `${r.left - boardRect.left}px`, top: `${r.top - boardRect.top}px`, width: `${r.width}px`, height: `${r.height}px` })
      board.append(layer)
      animations.push(layer.animate([{ transform: 'translate(0, 0)' }, { transform: `translate(${other.left - r.left}px, ${other.top - r.top}px)` }], { duration: TIMING.swap, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' }))
      return layer
    })
    void Promise.all(animations.map(a => a.finished)).then(() => {
      if (id !== revision || disposed) return
      swapped = true; round.finishSwap(performance.now()); shell.dataset.phase = 'playing'
      measure(); paint(performance.now())
      animations.forEach(a => a.cancel()); animations = []; layers.forEach(l => l.remove()); layers = []
      panels.forEach((p, i) => p.querySelector('.df-target')!.textContent = `PLAYER ${2 - i}의 얼굴에 그려요`)
      message('')
    }).catch(() => { /* Navigation cancels the transition and its completion callback. */ })
  }
  function frame(now: number) {
    if (disposed || !stream) return
    raf = requestAnimationFrame(frame)
    if (now - lastRender < 1000 / (low ? 20 : 30)) return
    lastRender = now; measure()
    try { detect(now) } catch (error) { fail(error, 'model'); return }
    gestures.forEach((g, i) => { if (now - g.seenAt > TIMING.handHold && g.update(null, 1, now).ended) drawings[i].end() })
    const before = round.phase
    round.tick(now, faces.every(face => face !== null && now - face.at < 300))
    if (round.phase === 'lobby') { stop(); return }
    if (before !== round.phase && round.phase === 'result') { drawings.forEach(d => d.end()); message('완성된 얼굴을 보여주세요') }
    if (round.phase === 'result' && now - round.since >= TIMING.notice) message('')
    shell.dataset.phase = round.phase
    countdown.hidden = round.phase !== 'countdown'
    if (!countdown.hidden) { countdown.querySelector('strong')!.textContent = String(round.seconds(now)); message('') }
    if (round.phase === 'waiting' && before === 'countdown') message('두 얼굴을 다시 보여주세요')
    const seconds = round.phase === 'playing' ? round.seconds(now) : round.phase === 'result' ? 0 : 60
    clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    paint(now)
    if (before !== 'swapping' && round.phase === 'swapping') swap()
  }
  const unregister = registerCaptureProvider({
    isAvailable: () => !disposed && !container.hidden && !!stream && video.readyState >= 2,
    draw: (ctx, width, height) => {
      const vertical = layouts[1]?.rect.top > layouts[0]?.rect.top + 10
      canvases.forEach((c, i) => ctx.drawImage(c, vertical ? 0 : i * width / 2, vertical ? i * height / 2 : 0, vertical ? width : width / 2, vertical ? height / 2 : height))
    },
  })
  return { resize: measure, dispose: () => { if (disposed) return; stop(); disposed = true; events.abort(); unregister(); rules.close(); container.innerHTML = '' } }
}
