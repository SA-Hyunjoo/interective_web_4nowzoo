import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ResidentModel } from './forest-resident-model'

export interface InteractiveResident { model: ResidentModel; normal: THREE.Vector3; heading: THREE.Vector3; time: number; restUntil: number }
export interface InteractionWorld {
  surface: HTMLCanvasElement; camera: THREE.PerspectiveCamera; controls: OrbitControls; scene: THREE.Scene
  terrain: THREE.Mesh; meetingCenter: THREE.Vector3; radius: (n: THREE.Vector3) => number; walkable: (n: THREE.Vector3) => boolean
}

export function createResidentInteraction(world: InteractionWorld, residents: InteractiveResident[], shell: HTMLElement, available: () => boolean) {
  const { surface, camera, controls } = world
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), yAxis = new THREE.Vector3(0, 1, 0)
  const ui = document.createElement('div'); ui.className = 'af-resident-actions'
  ui.innerHTML = `<button type="button" data-meeting>♧ 주민회의</button><button type="button" data-globe hidden>↗ 지구본으로</button><p role="status" aria-live="polite">주민 클릭 · 길게 눌러 옮기기</p>`; shell.append(ui)
  const message = ui.querySelector('p')!, meetingButton = ui.querySelector<HTMLButtonElement>('[data-meeting]')!, globeButton = ui.querySelector<HTMLButtonElement>('[data-globe]')!
  let following: InteractiveResident | null = null, yaw = 0, elevation = 0.36, distance = 2.5
  let savedView: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 } | null = null
  let gesture: { id: number; resident: InteractiveResident | null; x: number; y: number; lastX: number; lastY: number; moved: boolean; timer: number } | null = null
  let held: { resident: InteractiveResident; original: THREE.Vector3; candidate: THREE.Vector3; valid: boolean } | null = null
  let meeting = false
  const routes = new Map<InteractiveResident, { path: THREE.Vector3[]; target: THREE.Vector3; arrived: boolean; phase: number }>()
  const markerGeo = new THREE.RingGeometry(0.19, 0.23, 40), markerMat = new THREE.MeshBasicMaterial({ color: '#8ee5a9', side: THREE.DoubleSide, depthWrite: false })
  const marker = new THREE.Mesh(markerGeo, markerMat); marker.visible = false; world.scene.add(marker)
  type Node = { n: THREE.Vector3; edges: number[] }
  let graph: Node[] | null = null
  function setRay(x: number, y: number) {
    const rect = surface.getBoundingClientRect(); ndc.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1)
    camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera)
  }
  function pick(x: number, y: number) {
    setRay(x, y)
    const hit = ray.intersectObjects(residents.map(r => r.model.group), true)[0]
    if (!hit) return null
    const earth = ray.intersectObject(world.terrain)[0]
    if (earth && earth.distance < hit.distance - 0.06) return null
    return residents.find(r => { let object: THREE.Object3D | null = hit.object; while (object) { if (object === r.model.group) return true; object = object.parent } return false }) ?? null
  }
  function sync() { controls.enabled = available() && !following && !held && !gesture }
  function globe() {
    following = null
    if (savedView) { camera.position.copy(savedView.position); camera.up.copy(savedView.up); controls.target.copy(savedView.target); savedView = null; controls.update() }
    globeButton.hidden = true; message.textContent = '주민 클릭 · 길게 눌러 옮기기'; sync()
  }
  function follow(resident: InteractiveResident) {
    if (following === resident) { globe(); return }
    if (!savedView) savedView = { position: camera.position.clone(), target: controls.target.clone(), up: camera.up.clone() }
    following = resident; yaw = 0; elevation = 0.36; distance = 2.5; globeButton.hidden = false
    message.textContent = '주민을 따라가는 중 · 드래그로 시점 회전 · 다시 클릭하면 지구본'; sync(); updateCamera(1)
  }
  function updateCamera(dt: number) {
    if (!following || held) return
    const n = following.normal, forward = following.heading.clone().applyAxisAngle(n, yaw)
    const target = n.clone().multiplyScalar(world.radius(n) + 0.39)
    const position = target.clone().addScaledVector(forward, distance * Math.cos(elevation)).addScaledVector(n, distance * Math.sin(elevation))
    camera.position.lerp(position, 1 - Math.exp(-dt * 10)); camera.up.copy(n); camera.lookAt(target)
  }
  function cancelHold(commit: boolean) {
    if (!held) return
    held.resident.normal.copy(commit && held.valid ? held.candidate : held.original)
    held.resident.restUntil = 0.5; held = null; marker.visible = false; surface.style.cursor = ''; sync()
  }
  function stopMeeting() { meeting = false; routes.clear(); meetingButton.textContent = '♧ 주민회의'; meetingButton.setAttribute('aria-pressed', 'false') }
  function beginHold(resident: InteractiveResident) {
    if (!available() || !gesture) return
    if (following) globe()
    stopMeeting(); resident.restUntil = 10
    held = { resident, original: resident.normal.clone(), candidate: resident.normal.clone(), valid: true }
    marker.visible = true; marker.position.copy(resident.normal).multiplyScalar(world.radius(resident.normal) + 0.03); marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), resident.normal)
    surface.style.cursor = 'grabbing'; message.textContent = '잡았어요! 초록 표시의 땅에 놓아 주세요 · Esc 취소'; sync()
  }
  function pointerDown(event: PointerEvent) {
    if (!available() || event.button !== 0 || gesture) return
    const resident = pick(event.clientX, event.clientY)
    if (!resident && !following) return
    event.stopImmediatePropagation(); event.preventDefault()
    gesture = { id: event.pointerId, resident, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, timer: 0 }
    if (resident) gesture.timer = window.setTimeout(() => beginHold(resident), 430)
    surface.setPointerCapture(event.pointerId); sync()
  }
  function pointerMove(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return
    event.stopImmediatePropagation(); event.preventDefault()
    const dx = event.clientX - gesture.lastX, dy = event.clientY - gesture.lastY
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 7) { gesture.moved = true; if (!held) clearTimeout(gesture.timer) }
    if (held) {
      setRay(event.clientX, event.clientY); const hit = ray.intersectObject(world.terrain)[0]
      held.valid = false
      if (hit) {
        const n = hit.point.clone().normalize(); held.candidate.copy(n)
        held.valid = world.walkable(n) && residents.every(r => r === held!.resident || r.normal.distanceTo(n) > 0.095)
        marker.position.copy(n).multiplyScalar(world.radius(n) + 0.035); marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
      }
      markerMat.color.set(held.valid ? '#8ee5a9' : '#f08b7c'); message.textContent = held.valid ? '여기에 놓을 수 있어요' : '물·나무·다른 주민을 피해서 놓아 주세요'
    } else if (gesture.moved) {
      if (following) { yaw -= dx * 0.008; elevation = THREE.MathUtils.clamp(elevation + dy * 0.005, 0.12, 1.22) }
      else {
        const offset = camera.position.clone().sub(controls.target), horizontal = new THREE.Quaternion().setFromAxisAngle(camera.up, -dx * 0.006)
        offset.applyQuaternion(horizontal); const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
        offset.applyAxisAngle(right, -dy * 0.005); camera.position.copy(controls.target).add(offset); camera.lookAt(controls.target)
      }
    }
    gesture.lastX = event.clientX; gesture.lastY = event.clientY
  }
  function end(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return
    event.stopImmediatePropagation(); event.preventDefault(); clearTimeout(gesture.timer)
    const clicked = !held && !gesture.moved && event.type === 'pointerup' ? gesture.resident : null
    cancelHold(event.type === 'pointerup'); gesture = null
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
    if (clicked) follow(clicked); sync()
  }
  function wheel(event: WheelEvent) { if (!following || !available()) return; event.preventDefault(); event.stopImmediatePropagation(); distance = THREE.MathUtils.clamp(distance * Math.exp(event.deltaY * 0.001), 1.3, 5) }
  function cancelGesture() { if (gesture) { clearTimeout(gesture.timer); const id = gesture.id; gesture = null; if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id) } cancelHold(false); sync() }
  function key(event: KeyboardEvent) { if (event.key === 'Escape') { if (held || gesture) cancelGesture(); else if (following) globe() } }
  function visible() { if (document.hidden) cancelGesture() }
  function clearSegment(a: THREE.Vector3, b: THREE.Vector3) {
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.018))
    for (let i = 1; i <= steps; i++) if (!world.walkable(a.clone().lerp(b, i / steps).normalize())) return false
    return true
  }
  function navigation() {
    if (graph) return graph
    const geometry = new THREE.IcosahedronGeometry(1, 28), points = geometry.attributes.position, nodes: Node[] = [], ids: number[] = [], known = new Map<string, number>()
    for (let i = 0; i < points.count; i++) {
      const n = new THREE.Vector3().fromBufferAttribute(points, i).normalize(), key = `${Math.round(n.x * 1e5)},${Math.round(n.y * 1e5)},${Math.round(n.z * 1e5)}`
      let id = known.get(key)
      if (id === undefined) { id = nodes.length; known.set(key, id); nodes.push({ n, edges: [] }) }
      ids.push(id)
    }
    const valid = nodes.map(node => world.walkable(node.n)), edges = nodes.map(() => new Set<number>())
    for (let i = 0; i < ids.length; i += 3) for (let j = 0; j < 3; j++) {
      const a = ids[i + j]!, b = ids[i + (j + 1) % 3]!
      if (valid[a] && valid[b] && !edges[a]!.has(b) && clearSegment(nodes[a]!.n, nodes[b]!.n)) { edges[a]!.add(b); edges[b]!.add(a) }
    }
    nodes.forEach((node, i) => { node.edges = [...edges[i]!] }); geometry.dispose(); graph = nodes; return nodes
  }
  function meetingRoutes() {
    const nodes = navigation(), center = world.meetingCenter
    let source = 0, best = Infinity
    nodes.forEach((node, i) => { const d = node.n.distanceToSquared(center); if (node.edges.length && d < best) { best = d; source = i } })
    const distances = new Float64Array(nodes.length).fill(Infinity), parent = new Int32Array(nodes.length).fill(-1)
    const heap: { id: number; d: number }[] = []
    function push(value: { id: number; d: number }) { heap.push(value); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p]!.d <= value.d) break; heap[i] = heap[p]!; i = p } heap[i] = value }
    function pop() { const top = heap[0]!, last = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1]!.d < heap[child]!.d) child++; if (heap[child]!.d >= last.d) break; heap[i] = heap[child]!; i = child } heap[i] = last } return top }
    distances[source] = 0; push({ id: source, d: 0 })
    while (heap.length) { const { id, d } = pop(); if (d !== distances[id]) continue; for (const next of nodes[id]!.edges) { const value = d + nodes[id]!.n.distanceTo(nodes[next]!.n); if (value < distances[next]!) { distances[next] = value; parent[next] = id; push({ id: next, d: value }) } } }
    const right = new THREE.Vector3().crossVectors(yAxis, center).normalize(), forward = new THREE.Vector3().crossVectors(center, right).normalize()
    const slots: THREE.Vector3[] = []
    for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) {
      const x = (col + (Math.abs(row) % 2) * 0.5) * 0.112, y = row * 0.097
      if (Math.hypot(x, y) < 0.32) slots.push(center.clone().addScaledVector(right, x).addScaledVector(forward, y).normalize())
    }
    const unused = [...slots]; routes.clear(); let unreachable = 0
    for (const resident of residents) {
      unused.sort((a, b) => a.distanceToSquared(resident.normal) - b.distanceToSquared(resident.normal)); const target = unused.shift(); if (!target) continue
      let start = -1, nearest = Infinity
      nodes.forEach((node, i) => { const d = node.n.distanceToSquared(resident.normal); if (distances[i] !== Infinity && d < nearest && clearSegment(resident.normal, node.n)) { nearest = d; start = i } })
      if (start < 0) { unreachable++; continue }
      const path: THREE.Vector3[] = []; let cursor = start
      while (cursor >= 0) { const n = nodes[cursor]!.n; path.push(n); if (clearSegment(n, target)) break; cursor = parent[cursor]! }
      path.push(target); routes.set(resident, { path, target, arrived: false, phase: Math.random() * 6 })
    }
    message.textContent = unreachable ? `${residents.length - unreachable}명이 회의 장소로 이동 중이에요. 길이 막힌 주민은 길게 눌러 옮겨 주세요.` : '주민들이 공터로 모이고 있어요'
  }
  function toggleMeeting() {
    if (!available()) return
    if (meeting) { stopMeeting(); message.textContent = '회의가 끝났어요. 자유롭게 산책해요.'; return }
    if (!residents.length) { message.textContent = '먼저 주민을 입주시켜 주세요.'; return }
    cancelGesture(); globe(); meeting = true; meetingButton.textContent = '♧ 회의 끝내기'; meetingButton.setAttribute('aria-pressed', 'true'); meetingRoutes()
    camera.up.set(0, 1, 0); controls.target.set(0, 0, 0); camera.position.copy(world.meetingCenter).multiplyScalar(Math.max(15, camera.position.length())); controls.update()
  }
  meetingButton.addEventListener('click', toggleMeeting); globeButton.addEventListener('click', globe)
  surface.addEventListener('pointerdown', pointerDown, true); surface.addEventListener('pointermove', pointerMove, true); surface.addEventListener('pointerup', end, true); surface.addEventListener('pointercancel', end, true); surface.addEventListener('lostpointercapture', end, true); surface.addEventListener('wheel', wheel, { capture: true, passive: false })
  document.addEventListener('keydown', key); document.addEventListener('visibilitychange', visible)
  return {
    globe,
    suspend() { cancelGesture(); globe(); controls.enabled = false },
    residentUpdate(resident: InteractiveResident, dt: number) {
      if (held?.resident === resident) {
        const n = held.valid ? held.candidate : held.original
        resident.model.group.position.copy(n).multiplyScalar(world.radius(n) + 0.48)
        resident.model.group.quaternion.setFromUnitVectors(yAxis, n); resident.model.animate(resident.time, false, true); return true
      }
      const route = meeting ? routes.get(resident) : undefined
      if (!route) return false
      if (route.arrived) {
        const tangent = new THREE.Vector3().crossVectors(yAxis, route.target).normalize()
        const aim = route.target.clone().addScaledVector(tangent, Math.sin(resident.time * 0.7 + route.phase) * 0.003).normalize()
        resident.normal.copy(aim); resident.heading.copy(world.meetingCenter).addScaledVector(aim, -world.meetingCenter.dot(aim)).normalize()
        if (resident.heading.lengthSq() < 0.1) resident.heading.copy(tangent)
      } else {
        const target = route.path[0]
        if (!target) { route.arrived = true; return true }
        const delta = target.clone().addScaledVector(resident.normal, -target.dot(resident.normal)).normalize()
        const remaining = resident.normal.distanceTo(target), step = Math.min(remaining, dt * 0.14)
        let candidate = resident.normal.clone().addScaledVector(delta, step).normalize()
        if (remaining < 0.018 && clearSegment(resident.normal, target) && residents.every(other => other === resident || other.normal.distanceTo(target) > 0.09)) {
          resident.normal.copy(target); route.path.shift()
          if (!route.path.length) route.arrived = true
          return true
        }
        const blocked = residents.some(other => other !== resident && other.normal.distanceTo(candidate) < 0.09 && other.normal.distanceTo(candidate) < other.normal.distanceTo(resident.normal))
        if (blocked || !world.walkable(candidate)) {
          let alternative: THREE.Vector3 | null = null
          for (const angle of [0.55, -0.55, 1.05, -1.05, 1.6, -1.6, 2.2, -2.2]) {
            const next = resident.normal.clone().addScaledVector(delta.clone().applyAxisAngle(resident.normal, angle), dt * 0.12).normalize()
            if (world.walkable(next) && residents.every(other => other === resident || other.normal.distanceTo(next) >= 0.09 || other.normal.distanceTo(next) > other.normal.distanceTo(resident.normal))) { alternative = next; break }
          }
          if (!alternative) return true
          candidate = alternative
        }
        if (world.walkable(candidate)) { resident.normal.copy(candidate); resident.heading.lerp(delta, Math.min(1, dt * 8)).addScaledVector(candidate, -resident.heading.dot(candidate)).normalize() }
        if (!route.path.length) { resident.normal.copy(route.target); route.arrived = true }
      }
      const right = new THREE.Vector3().crossVectors(resident.normal, resident.heading).normalize(), forward = new THREE.Vector3().crossVectors(right, resident.normal).normalize()
      resident.model.group.position.copy(resident.normal).multiplyScalar(world.radius(resident.normal) + 0.015)
      resident.model.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, resident.normal, forward)); resident.model.animate(resident.time, !route.arrived)
      return true
    },
    update(dt: number) { if (!available()) return; updateCamera(dt); if (meeting && routes.size && [...routes.values()].every(route => route.arrived)) message.textContent = `주민 ${routes.size}명이 모였어요 · 회의 끝내기를 누르면 다시 산책해요` },
    dispose() { cancelGesture(); globe(); surface.removeEventListener('pointerdown', pointerDown, true); surface.removeEventListener('pointermove', pointerMove, true); surface.removeEventListener('pointerup', end, true); surface.removeEventListener('pointercancel', end, true); surface.removeEventListener('lostpointercapture', end, true); surface.removeEventListener('wheel', wheel, true); document.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visible); marker.removeFromParent(); markerGeo.dispose(); markerMat.dispose(); ui.remove(); graph = null },
  }
}
