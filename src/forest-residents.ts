import * as THREE from 'three'
import { createResidentVision, canvas } from './forest-resident-vision'
import type { ResidentSkin, ResidentVision, ShapeProfile } from './forest-resident-vision'
import { createResidentModel } from './forest-resident-model'
import type { ResidentModel } from './forest-resident-model'
import './forest-residents.css'
import { createResidentInteraction } from './forest-resident-interaction'
import type { InteractionWorld } from './forest-resident-interaction'
import { createTextureEditor } from './forest-texture-editor'

interface SavedResident { shape: ShapeProfile; skin: ResidentSkin; normal: THREE.Vector3; heading: THREE.Vector3 }
// Keep masked portraits only in tab memory. No uploads, original-photo storage or disk persistence.
const village: SavedResident[] = []
interface Resident extends SavedResident { model: ResidentModel; turnAt: number; restUntil: number; time: number }
interface World extends InteractionWorld { root: HTMLElement; scene: THREE.Scene; planet: THREE.Group; camera: THREE.PerspectiveCamera; radius: (n: THREE.Vector3) => number; walkable: (n: THREE.Vector3) => boolean; enableControls: (enabled: boolean) => void }

export function setupForestResidents(world: World) {
  const { root, scene, planet, camera } = world
  const shell = root.querySelector<HTMLElement>('.af-world')!
  const launcher = document.createElement('div'); launcher.className = 'af-residency'
  launcher.innerHTML = `<span class="af-resident-count">우리 별의 주민 <b>${village.length}</b>명</span><button class="af-move-in" type="button"><span>＋</span> 입주하기</button>`
  shell.append(launcher)
  const dialog = document.createElement('dialog'); dialog.className = 'af-enrollment'; dialog.setAttribute('aria-labelledby', 'af-enroll-title')
  dialog.innerHTML = `<button class="af-enroll-close" type="button" aria-label="입주 취소">×</button>
    <header class="af-enroll-heading"><span>WELCOME TO YOUR LITTLE WORLD</span><h2 id="af-enroll-title">어떤 이웃이 되어볼까요?</h2><p class="af-enroll-status" role="status" aria-live="polite">카메라를 준비하고 있어요.</p></header>
    <div class="af-enroll-panels"><section class="af-camera-panel"><video autoplay muted playsinline></video><div class="af-camera-guide"></div><span class="af-panel-label">01 · 나의 모습</span><p class="af-camera-help">얼굴과 팔다리가 보이도록 한 걸음 뒤로 서 주세요</p><strong class="af-countdown" hidden></strong><div class="af-shutter"></div></section>
    <button class="af-image-panel" type="button"><span class="af-panel-label">02 · 되고 싶은 모습</span><span class="af-upload-placeholder"><b>＋</b><strong>이미지를 추가해 주세요</strong><small>클릭해서 선택하거나 여기에 끌어다 놓으세요</small><em>동물 · 캐릭터 · 사람 · 좋아하는 물건</em></span><canvas hidden></canvas><span class="af-upload-caption" hidden>이미지가 준비됐어요</span></button></div>
    <input class="af-resident-file" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/heic,image/heif" hidden>
    <div class="af-enroll-footer"><p>이미지를 넣으면 <b>5초 후 사진을 촬영</b>해요.<br><span>사진은 이 브라우저 안에서만 처리됩니다.</span></p><button class="af-enroll-retry" type="button" hidden>다시 촬영하기</button></div>
    <div class="af-enroll-progress" hidden><span></span><p>새로운 이웃을 만들고 있어요</p></div>
    <div class="af-welcome" hidden><span>HELLO, NEIGHBOR!</span><h3>우리 별에 온 걸 환영해요</h3><p>모습을 확인하고 입주시켜 주세요.</p></div>
    <div class="af-preview-hitarea" hidden></div>
    <div class="af-preview-actions" hidden><button type="button" data-edit-start>수정하기</button><button type="button" data-depart>입주시키기</button></div>
    <div class="af-texture-tools" hidden><strong>텍스처 수정</strong><label>도구 <select data-brush-mode><option value="move">부드럽게 당기기</option><option value="expand">늘리기</option><option value="shrink">줄이기</option><option value="rotate">모델 회전</option></select></label><label>영향 범위 <input data-brush-size type="range" min="0.12" max="0.5" step="0.01" value="0.28"></label><button type="button" data-edit-undo>되돌리기</button><button type="button" data-edit-reset>초기화</button><button type="button" data-edit-done>수정 완료</button><p data-edit-hint>표면을 드래그해 사진을 맞춰 주세요. 오른쪽 드래그 / Alt + 드래그로 모델을 돌릴 수 있어요.</p></div>`
  shell.append(dialog)
  const video = dialog.querySelector<HTMLVideoElement>('video')!, imagePanel = dialog.querySelector<HTMLButtonElement>('.af-image-panel')!
  const input = dialog.querySelector<HTMLInputElement>('input')!, uploaded = dialog.querySelector<HTMLCanvasElement>('.af-image-panel canvas')!
  const status = dialog.querySelector<HTMLElement>('.af-enroll-status')!, countdown = dialog.querySelector<HTMLElement>('.af-countdown')!
  const retry = dialog.querySelector<HTMLButtonElement>('.af-enroll-retry')!, progress = dialog.querySelector<HTMLElement>('.af-enroll-progress')!
  const controller = new AbortController()
  let visionPromise: Promise<ResidentVision> | undefined, vision: ResidentVision | undefined
  let disposed = false, revision = 0, stream: MediaStream | null = null, timer = 0, deadline = 0, image: HTMLCanvasElement | null = null
  let phase: 'closed' | 'camera' | 'countdown' | 'processing' | 'reveal' = 'closed'
  const inhabitants: Resident[] = []
  const up = new THREE.Vector3(0, 1, 0), matrix = new THREE.Matrix4()
  let arrival: { saved: SavedResident; model: ResidentModel; start: THREE.Vector3; rotation: THREE.Quaternion; time: number; departing: boolean } | null = null
  let editing = false
  const previewActions = dialog.querySelector<HTMLElement>('.af-preview-actions')!
  const textureEditor = createTextureEditor(dialog.querySelector<HTMLElement>('.af-preview-hitarea')!, world.surface, camera, () => arrival?.model ?? null, dialog.querySelector<HTMLElement>('.af-texture-tools')!)
  const interaction = createResidentInteraction(world, inhabitants, shell, () => !disposed && phase === 'closed')
  let controlsWereDisabled = false
  const announce = (message: string) => { status.textContent = message }
  const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  const alive = (id: number) => !disposed && id === revision && phase !== 'closed'
  function stopCamera() { stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null }
  function updateCount() { launcher.querySelector('b')!.textContent = String(village.length) }
  function orient(model: ResidentModel, n: THREE.Vector3, heading: THREE.Vector3) {
    const right = new THREE.Vector3().crossVectors(n, heading).normalize()
    const forward = new THREE.Vector3().crossVectors(right, n).normalize()
    matrix.makeBasis(right, n, forward); model.group.quaternion.setFromRotationMatrix(matrix)
    model.group.position.copy(n).multiplyScalar(world.radius(n) + 0.015)
  }
  function add(saved: SavedResident, model = createResidentModel(saved.shape, saved.skin)) {
    scene.add(model.group); model.group.scale.setScalar(0.55)
    orient(model, saved.normal, saved.heading)
    inhabitants.push({ ...saved, model, turnAt: 1 + Math.random() * 3, restUntil: 0, time: Math.random() * 10 })
  }
  village.forEach(saved => add(saved))
  function safe(n: THREE.Vector3) { return world.walkable(n) && inhabitants.every(resident => resident.normal.distanceTo(n) > 0.065) }
  function spawn() {
    const facing = camera.position.clone().normalize()
    for (let i = 0; i < 600; i++) {
      const n = facing.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.5)).normalize()
      if (safe(n)) return n
    }
    throw new Error('이쪽 숲에 빈자리가 없어요. 지구본을 조금 돌린 뒤 다시 입주해 주세요.')
  }
  function loadVision() {
    if (!visionPromise) {
      visionPromise = createResidentVision(controller.signal).then(value => { vision = value; return value }).catch(error => { visionPromise = undefined; throw error })
      // Loading can finish after the dialog closes; resources belong to the forest controller.
      void visionPromise.catch(() => {})
    }
    return visionPromise
  }
  function resetUI() {
    dialog.dataset.phase = 'camera'; countdown.hidden = true; progress.hidden = true; retry.hidden = true
    dialog.querySelector<HTMLElement>('.af-welcome')!.hidden = true
    dialog.querySelector<HTMLElement>('.af-welcome')!.style.opacity = ''
    imagePanel.disabled = false; uploaded.hidden = true; input.value = ''; image = null
    dialog.querySelector<HTMLElement>('.af-upload-placeholder')!.hidden = false
    dialog.querySelector<HTMLElement>('.af-upload-caption')!.hidden = true
  }
  function close() {
    revision++; clearInterval(timer); timer = 0; stopCamera(); image = null; uploaded.width = uploaded.height = 1; phase = 'closed'; planet.visible = true
    editing = false; textureEditor.setActive(false); textureEditor.clear(); previewActions.hidden = true
    arrival?.model.dispose(); arrival = null
    if (controlsWereDisabled) { world.enableControls(true); controlsWereDisabled = false }
    if (dialog.open) dialog.close()
    launcher.querySelector<HTMLButtonElement>('button')!.focus()
  }
  function fail(error: unknown, id: number) {
    if (!alive(id)) return
    clearInterval(timer); timer = 0; stopCamera(); phase = 'camera'; dialog.dataset.phase = 'camera'
    countdown.hidden = true; progress.hidden = true; retry.hidden = false; imagePanel.disabled = false
    const message = error instanceof Error ? error.message : '잠시 문제가 생겼어요. 다시 시도해 주세요.'
    announce(error instanceof DOMException && error.name === 'NotAllowedError' ? '카메라 권한을 허용한 뒤 다시 촬영해 주세요.' : message)
  }
  async function startCamera(id: number) {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('카메라를 사용하려면 인증서가 신뢰된 HTTPS 주소로 접속해 주세요.')
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false })
      if (!alive(id)) { acquired.getTracks().forEach(track => track.stop()); return }
      stream = acquired; video.srcObject = acquired; await video.play()
      if (!alive(id)) return
      for (const track of acquired.getVideoTracks()) track.addEventListener('ended', () => { if (alive(id) && phase !== 'processing' && phase !== 'reveal') fail(new Error('카메라 연결이 끊어졌어요. 다시 촬영해 주세요.'), id) }, { once: true })
      announce('오른쪽에 이미지를 넣으면 5초 후 사진을 촬영해요.')
      if (image) beginCountdown(id)
    } catch (error) { fail(error, id) }
  }
  async function open() {
    if (village.length >= 24) { launcher.querySelector<HTMLElement>('.af-resident-count')!.textContent = '이번 숲에는 최대 24명까지 입주할 수 있어요'; return }
    interaction.suspend()
    revision++; const id = revision; phase = 'camera'; resetUI(); announce('카메라 권한을 허용해 주세요.'); dialog.showModal()
    world.enableControls(false); controlsWereDisabled = true
    void loadVision().catch(error => { if (alive(id) && phase === 'camera') announce(`주민 만들기 준비에 실패했어요. 다시 촬영 버튼으로 재시도해 주세요. ${error instanceof Error ? error.message : ''}`) })
    await startCamera(id)
  }
  function beginCountdown(id: number) {
    if (!image || !stream || video.readyState < 2 || !alive(id) || phase !== 'camera') return
    phase = 'countdown'; retry.hidden = true; imagePanel.disabled = true; countdown.hidden = false; deadline = performance.now() + 5000
    announce('5초 후 사진을 촬영해요. 얼굴과 팔다리를 카메라 안에 보여 주세요.')
    countdown.textContent = '5'
    timer = window.setInterval(() => {
      if (!alive(id)) { clearInterval(timer); return }
      const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000)); countdown.textContent = String(remaining)
      if (remaining === 0) { clearInterval(timer); timer = 0; void capture(id) }
    }, 80)
  }
  async function capture(id: number) {
    if (!alive(id) || !image) return
    try {
      if (video.readyState < 2 || !video.videoWidth || !stream?.active) throw new Error('카메라 영상을 받지 못했어요. 다시 촬영해 주세요.')
      phase = 'processing'; countdown.hidden = true; dialog.dataset.phase = 'processing'; progress.hidden = false
      const scale = Math.min(1, 960 / video.videoWidth), photo = canvas(Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale))
      photo.getContext('2d')!.drawImage(video, 0, 0, photo.width, photo.height); stopCamera()
      announce('촬영 완료! 이미지와 사람의 모습을 분석하고 있어요.'); await tick()
      const models = await loadVision(); if (!alive(id)) return
      announce('이미지의 형체를 알아보고 있어요.'); await tick(); await tick()
      const shape = models.analyze(image); if (!alive(id)) return
      announce('배경을 지우고 사람의 얼굴과 몸을 입히고 있어요.'); await tick(); await tick()
      const skin = models.skin(photo); photo.width = photo.height = 1
      if (!alive(id)) return
      announce('작은 주민을 만들고 있어요.'); await tick(); await tick()
      const normal = spawn(), heading = new THREE.Vector3().crossVectors(normal, up).normalize()
      if (heading.lengthSq() < 0.1) heading.set(1, 0, 0)
      const saved: SavedResident = { shape, skin, normal, heading }, model = createResidentModel(shape, skin)
      const cameraUp = up.clone().applyQuaternion(camera.quaternion), forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      // Fit the large result even in a narrow portrait viewport.
      const previewScale = Math.min(2.65, camera.aspect * 3.1)
      const start = camera.position.clone().addScaledVector(forward, 7.5).addScaledVector(cameraUp, -0.7 * previewScale)
      model.group.position.copy(start); model.group.quaternion.copy(camera.quaternion); model.group.scale.setScalar(previewScale); model.group.userData.previewScale = previewScale
      scene.add(model.group); planet.visible = false
      arrival = { saved, model, start, rotation: camera.quaternion.clone(), time: 0, departing: false }
      previewActions.hidden = false
      phase = 'reveal'; dialog.dataset.phase = 'reveal'; progress.hidden = true; image = null
      const welcome = dialog.querySelector<HTMLElement>('.af-welcome')!; welcome.hidden = false
      welcome.querySelector('p')!.textContent = `${shape.label}에서 태어난 작은 이웃 · 수정하거나 입주시켜 주세요`
    } catch (error) { fail(error, id) }
  }
  async function selectFile(file?: File) {
    if (!file || phase !== 'camera') return
    const id = revision
    try {
      if (!/^image\/(png|jpeg|webp|avif|heic|heif)$/.test(file.type)) throw new Error('PNG, JPG, WebP 등 사진 파일을 선택해 주세요.')
      if (file.size > 20 * 1024 * 1024) throw new Error('20MB 이하의 이미지를 선택해 주세요.')
      const bitmap = await createImageBitmap(file)
      if (!alive(id) || phase !== 'camera') { bitmap.close(); return }
      const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height)), selected = canvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
      selected.getContext('2d')!.drawImage(bitmap, 0, 0, selected.width, selected.height); bitmap.close(); image = selected
      uploaded.width = selected.width; uploaded.height = selected.height; uploaded.getContext('2d')!.drawImage(selected, 0, 0); uploaded.hidden = false
      dialog.querySelector<HTMLElement>('.af-upload-placeholder')!.hidden = true; dialog.querySelector<HTMLElement>('.af-upload-caption')!.hidden = false
      if (stream && video.readyState >= 2) beginCountdown(id)
      else { announce('이미지가 준비됐어요. 카메라가 켜지면 5초 카운트가 시작돼요.'); if (!stream) retry.hidden = false }
    } catch (error) { if (alive(id)) announce(error instanceof Error ? error.message : '이미지를 열지 못했어요. JPG 또는 PNG로 다시 선택해 주세요.') }
  }
  dialog.querySelector('[data-edit-start]')!.addEventListener('click', () => { if (!arrival || arrival.departing) return; editing = true; previewActions.hidden = true; textureEditor.setActive(true); dialog.dataset.editing = 'true' })
  dialog.querySelector('[data-edit-done]')!.addEventListener('click', () => {
    if (!arrival) return
    arrival.saved.skin.textureEdits = arrival.model.textures.map(texture => { const source = texture.image as HTMLCanvasElement, copy = canvas(source.width, source.height); copy.getContext('2d')!.drawImage(source, 0, 0); return copy })
    editing = false; textureEditor.setActive(false); previewActions.hidden = false; delete dialog.dataset.editing
  })
  dialog.querySelector('[data-depart]')!.addEventListener('click', () => { if (!arrival) return; arrival.departing = true; arrival.time = 0; arrival.rotation.copy(arrival.model.group.quaternion); previewActions.hidden = true; dialog.querySelector('.af-welcome p')!.textContent = '새로운 집으로 이사하고 있어요.' })
  launcher.querySelector('button')!.addEventListener('click', open)
  imagePanel.addEventListener('click', () => { if (phase === 'camera') input.click() })
  input.addEventListener('change', () => { void selectFile(input.files?.[0]); input.value = '' })
  imagePanel.addEventListener('dragover', event => { event.preventDefault(); if (phase === 'camera') imagePanel.classList.add('is-dragging') })
  imagePanel.addEventListener('dragleave', () => imagePanel.classList.remove('is-dragging'))
  imagePanel.addEventListener('drop', event => { event.preventDefault(); imagePanel.classList.remove('is-dragging'); void selectFile(event.dataTransfer?.files[0]) })
  dialog.addEventListener('dragover', event => event.preventDefault())
  dialog.addEventListener('drop', event => event.preventDefault())
  dialog.querySelector('.af-enroll-close')!.addEventListener('click', close)
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  retry.addEventListener('click', () => { if (phase !== 'camera') return; revision++; retry.hidden = true; stopCamera(); announce('카메라를 다시 준비하고 있어요.'); void loadVision().catch(() => {}); void startCamera(revision) })
  const visibility = () => { if (document.hidden && phase !== 'closed') close() }
  document.addEventListener('visibilitychange', visibility)
  return {
    returnToGlobe: () => interaction.globe(),
    update(dt: number) {
      if (disposed) return
      dt = Math.min(dt, 0.05)
      for (const resident of inhabitants) {
        resident.model.group.visible = !arrival || arrival.departing
        resident.time += dt; resident.turnAt -= dt; resident.restUntil = Math.max(0, resident.restUntil - dt)
        if (interaction.residentUpdate(resident, dt)) continue
        if (resident.turnAt <= 0) { resident.heading.applyAxisAngle(resident.normal, (Math.random() - 0.5) * 1.7); resident.turnAt = 2 + Math.random() * 5; if (Math.random() < 0.28) resident.restUntil = 0.5 + Math.random() * 1.5 }
        const walking = resident.restUntil <= 0
        if (walking) {
          const candidate = resident.normal.clone().addScaledVector(resident.heading, dt * 0.025).normalize()
          if (world.walkable(candidate) && inhabitants.every(other => other === resident || other.normal.distanceTo(candidate) > 0.062)) {
            resident.normal.copy(candidate); resident.heading.addScaledVector(candidate, -resident.heading.dot(candidate)).normalize()
          } else { resident.heading.applyAxisAngle(resident.normal, 0.8 + Math.random() * 1.2); resident.restUntil = 0.15 }
        }
        orient(resident.model, resident.normal, resident.heading); resident.model.animate(resident.time, walking)
      }
      if (arrival) {
        arrival.time += dt
        const { model, saved, start, rotation, time } = arrival
        model.animate(editing ? 0 : time, false)
        if (arrival.departing) {
          planet.visible = true
          const t = Math.min(1, time / 2.2), eased = t * t * (3 - 2 * t)
          const target = saved.normal.clone().multiplyScalar(world.radius(saved.normal) + 0.015)
          orient(model, saved.normal, saved.heading); const targetRotation = model.group.quaternion.clone()
          model.group.position.lerpVectors(start, target, eased)
          model.group.quaternion.copy(rotation).slerp(targetRotation, eased)
          model.group.scale.setScalar(THREE.MathUtils.lerp(model.group.userData.previewScale as number, 0.55, eased))
          dialog.querySelector<HTMLElement>('.af-welcome')!.style.opacity = String(1 - eased)
          if (t >= 1) {
            village.push(saved); arrival = null; add(saved, model); updateCount(); dialog.querySelector<HTMLElement>('.af-welcome')!.style.opacity = ''
            close()
          }
        }
      }
      interaction.update(dt)
    },
    dispose() {
      disposed = true; controller.abort(); interaction.dispose(); textureEditor.dispose(); close(); vision?.close(); vision = undefined
      inhabitants.forEach(resident => resident.model.dispose()); document.removeEventListener('visibilitychange', visibility); dialog.remove(); launcher.remove()
    },
  }
}
