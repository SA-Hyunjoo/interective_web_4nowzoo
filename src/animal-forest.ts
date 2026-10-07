import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { registerCaptureProvider } from './capture-controller'
import { setupForestResidents } from './forest-residents'
import './animal-forest.css'

export interface AnimalForestController { resize: () => void; dispose: () => void }

// A single, seeded spherical landscape; no tiled terrain or repeated map sections.
export function setupAnimalForest(root: HTMLElement): AnimalForestController {
  root.innerHTML = `<main class="af-world">
    <header class="af-heading"><span class="af-eyebrow">A LITTLE WORLD, ALL YOUR OWN</span><h1>동물의 숲<span>작은 초록별 산책</span></h1><p>숲 너머에는, 또 다른 계절이 기다려요.</p></header>
    <div class="af-stage" role="img" aria-label="드래그로 회전하고 마우스 휠로 확대하는 숲 지구본"></div>
    <div class="af-note"><span class="af-leaf">❧</span><div><b>오늘은 어디로 걸어볼까요?</b><p>꽃이 핀 언덕부터 작은 강 너머까지</p></div></div>
    <div class="af-controls"><button type="button" data-action="reset" title="처음 시점으로">↺ <span>처음 풍경</span></button><span class="af-divider"></span><button type="button" data-action="out" aria-label="축소">−</button><button type="button" data-action="in" aria-label="확대">＋</button></div>
    <div class="af-hint"><span>↔ 드래그하여 둘러보기</span><i></i><span>마우스 휠로 가까이 보기</span></div><span class="af-edition">FOREST PLANET / 012</span>
  </main>`
  const stage = root.querySelector<HTMLElement>('.af-stage')!
  let seed = 41275
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const scene = new THREE.Scene()
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  stage.append(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.065
  controls.enablePan = false
  controls.rotateSpeed = 0.65
  controls.zoomSpeed = 0.75
  controls.minDistance = 8
  controls.maxDistance = 38
  scene.add(new THREE.HemisphereLight(0xfffbe2, 0x8dac8a, 2.7))
  const sun = new THREE.DirectionalLight(0xffeed2, 3.3)
  sun.position.set(-8, 12, 13)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 40 })
  sun.shadow.normalBias = 0.035
  sun.shadow.bias = -0.0002
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xcbe9ff, 1.5)
  fill.position.set(6, 1, -9); scene.add(fill)
  const planet = new THREE.Group(); scene.add(planet)
  const direction = (lat: number, lon: number) => new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon))
  const up = new THREE.Vector3(0, 1, 0)
  const meetingCenter = direction(-0.10, 0.90)
  function field(n: THREE.Vector3) {
    return Math.sin(n.x * 5.3 + n.z * 2.7) * Math.cos(n.y * 6.1 - n.z * 1.9) * 0.5 + Math.sin(n.z * 11 + n.y * 7 + n.x * 3) * 0.2
  }
  const lake = direction(0.26, -0.45)
  const pond = direction(-0.5, 2.4)
  function waterDistance(n: THREE.Vector3) {
    const lat = Math.asin(n.y), lon = Math.atan2(n.x, n.z)
    const river = (0.18 + 0.27 * Math.sin(lat * 3.8) + 0.08 * Math.sin(lat * 10))
    const riverDistance = Math.abs(Math.atan2(Math.sin(lon - river), Math.cos(lon - river))) * Math.max(0.2, Math.cos(lat))
    const branch = Math.abs(lat - 0.2 - 0.12 * Math.sin(lon * 5))
    return Math.min(riverDistance - 0.035, n.distanceTo(lake) - 0.19, n.distanceTo(pond) - 0.15,
      lon > -0.5 && lon < 0.35 ? branch - 0.027 : 10)
  }
  function radius(n: THREE.Vector3) {
    const d = waterDistance(n)
    const bank = THREE.MathUtils.smoothstep(d, 0, 0.035)
    const natural = 4.70 + bank * (0.19 + THREE.MathUtils.smoothstep(d, 0.09, 0.19) * Math.max(0, field(n)) * 0.36)
    return THREE.MathUtils.lerp(4.91, natural, THREE.MathUtils.smoothstep(n.distanceTo(meetingCenter), 0.32, 0.38))
  }
  const grassTextureCanvas = document.createElement('canvas')
  grassTextureCanvas.width = grassTextureCanvas.height = 512
  const ctx = grassTextureCanvas.getContext('2d')!
  ctx.fillStyle = '#d5ddad'; ctx.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 24000; i++) {
    ctx.fillStyle = random() > 0.5 ? `rgba(255,255,220,${random() * 0.22})` : `rgba(65,102,36,${random() * 0.18})`
    ctx.fillRect(random() * 512, random() * 512, 1 + random() * 3, 1 + random() * 4)
  }
  const texture = new THREE.CanvasTexture(grassTextureCanvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(8, 4); texture.colorSpace = THREE.SRGBColorSpace
  const terrainGeo = new THREE.SphereGeometry(1, 256, 160)
  const positions = terrainGeo.attributes.position
  const colors = new Float32Array(positions.count * 3)
  const grassA = new THREE.Color('#8fc85d'), grassB = new THREE.Color('#bad47a'), cliff = new THREE.Color('#dbad7c')
  const temp = new THREE.Vector3(), tint = new THREE.Color()
  for (let i = 0; i < positions.count; i++) {
    temp.fromBufferAttribute(positions, i).normalize()
    const d = waterDistance(temp)
    tint.copy(grassA).lerp(grassB, THREE.MathUtils.clamp(0.5 + field(temp), 0, 1))
    if (d < 0.026) tint.copy(cliff).multiplyScalar(0.94 + 0.06 * Math.sin(temp.y * 180))
    tint.toArray(colors, i * 3)
    temp.multiplyScalar(radius(temp)); positions.setXYZ(i, temp.x, temp.y, temp.z)
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3)); terrainGeo.computeVertexNormals()
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, map: texture, roughness: 0.93 }))
  terrain.receiveShadow = true; terrain.castShadow = true; planet.add(terrain)
  const water = new THREE.Mesh(new THREE.SphereGeometry(4.756, 128, 96), new THREE.MeshPhysicalMaterial({ color: '#65c8d1', roughness: 0.24, metalness: 0.08, clearcoat: 0.55 }))
  planet.add(water)

  // Batch the hand-shaped foliage and small decorations into a few draw calls.
  const sphere = new THREE.SphereGeometry(1, 9, 6)
  const cone = new THREE.ConeGeometry(1, 1, 10)
  const cylinder = new THREE.CylinderGeometry(0.75, 1, 1, 8)
  const box = new THREE.BoxGeometry(1, 1, 1)
  type Batch = { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; matrices: THREE.Matrix4[]; colors: THREE.Color[] }
  const batches = new Map<string, Batch>()
  const object = new THREE.Object3D()
  let frame = new THREE.Matrix4()
  function part(kind: string, geometry: THREE.BufferGeometry, color: string | number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
    let batch = batches.get(kind)
    if (!batch) { batch = { geometry, material: new THREE.MeshStandardMaterial({ roughness: 0.88 }), matrices: [], colors: [] }; batches.set(kind, batch) }
    object.position.set(x, y, z); object.rotation.set(rx, ry, rz); object.scale.set(sx, sy, sz); object.updateMatrix()
    batch.matrices.push(new THREE.Matrix4().multiplyMatrices(frame, object.matrix)); batch.colors.push(new THREE.Color(color))
  }
  function place(n: THREE.Vector3, turn = random() * Math.PI * 2) {
    const q = new THREE.Quaternion().setFromUnitVectors(up, n).multiply(new THREE.Quaternion().setFromAxisAngle(up, turn))
    frame = new THREE.Matrix4().compose(n.clone().multiplyScalar(radius(n)), q, new THREE.Vector3(1, 1, 1))
  }
  const greens = ['#568d42', '#6fa746', '#82b74e', '#91bd57', '#5b984d']
  function tree(n: THREE.Vector3, pine: boolean, pink: boolean) {
    place(n)
    const s = 0.7 + random() * 0.55
    part('wood', cylinder, '#a67949', 0, 0.28 * s, 0, 0.085 * s, 0.56 * s, 0.085 * s)
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2
      part('roots', sphere, '#aa8050', Math.sin(a) * 0.065 * s, 0.035, Math.cos(a) * 0.065 * s, 0.065 * s, 0.055, 0.13 * s, 0, a)
    }
    if (pine) {
      for (let layer = 0; layer < 4; layer++) {
        const width = (0.37 - layer * 0.065) * s, y = (0.48 + layer * 0.19) * s
        part('pine', cone, greens[(layer + 1) % greens.length]!, 0, y, 0, width, 0.46 * s, width)
        for (let j = 0; j < 11; j++) {
          const a = j / 11 * Math.PI * 2
          part('leaf', sphere, greens[(layer + 2) % greens.length]!, Math.sin(a) * width * 0.76, y - 0.15 * s, Math.cos(a) * width * 0.76, 0.073 * s, 0.14 * s, 0.045 * s, -0.45 * Math.cos(a), a, 0.45 * Math.sin(a))
        }
      }
    } else {
      const base = pink ? '#eeb6bc' : greens[Math.floor(random() * greens.length)]!
      part('crown', sphere, base, 0, 0.72 * s, 0, 0.37 * s, 0.4 * s, 0.35 * s)
      for (let j = 0; j < 58; j++) {
        const h = -0.65 + random() * 1.6, a = j * 2.39996, r = Math.sqrt(1 - h * h)
        const color = pink ? ['#edb2bf', '#f9d4cd', '#db9dab'][j % 3]! : greens[j % greens.length]!
        part('leaf', sphere, color, Math.sin(a) * r * 0.33 * s, (0.73 + h * 0.32) * s, Math.cos(a) * r * 0.33 * s, 0.115 * s, 0.16 * s, 0.053 * s, 0.25, a, 0.25 * Math.sin(a))
      }
      if (!pink && random() < 0.27) for (let j = 0; j < 3; j++) {
        const a = j * 2.1
        part('fruit', sphere, '#e67d45', Math.sin(a) * 0.29 * s, 0.6 * s, Math.cos(a) * 0.29 * s, 0.063, 0.071, 0.063)
      }
    }
  }
  const normals: THREE.Vector3[] = []
  const cottageN = direction(0.23, -0.87)
  for (let i = 0; i < 290; i++) {
    const y = 1 - (i + 0.5) / 290 * 2, a = i * 2.399963 + random() * 0.2
    const n = new THREE.Vector3(Math.sqrt(1 - y * y) * Math.sin(a), y, Math.sqrt(1 - y * y) * Math.cos(a))
    if (n.distanceTo(meetingCenter) < 0.39 || waterDistance(n) < 0.072 || n.distanceTo(cottageN) < 0.19 || field(n) < -0.31) continue
    normals.push(n)
    tree(n, field(n) > 0.12, n.x < -0.25 && n.y < -0.08 && n.z > 0.3)
  }
  for (let i = 0; i < 2200; i++) {
    const n = direction(Math.asin(random() * 2 - 1), random() * Math.PI * 2)
    if (n.distanceTo(meetingCenter) < 0.34 || waterDistance(n) < 0.04 || n.distanceTo(cottageN) < 0.14) continue
    place(n)
    const a = random(), size = 0.7 + random() * 0.6
    if (a < 0.58) {
      for (let k = 0; k < 3; k++) part('grass', cone, k % 2 ? '#79aa53' : '#a6c86b', (k - 1) * 0.027, 0.045 * size, 0, 0.015, 0.11 * size, 0.013, 0, 0, (k - 1) * 0.3)
    } else if (a < 0.92) {
      const flowerColor = n.x > 0.45 ? '#f6cc59' : n.y < -0.2 ? '#e998b0' : '#fff5ce'
      part('stem', cylinder, '#669448', 0, 0.056, 0, 0.009, 0.12, 0.009)
      for (let j = 0; j < 5; j++) { const angle = j * Math.PI * 2 / 5; part('petals', sphere, flowerColor, Math.cos(angle) * 0.027, 0.13, Math.sin(angle) * 0.027, 0.025, 0.014, 0.025) }
      part('petals', sphere, '#e5ac46', 0, 0.141, 0, 0.014, 0.012, 0.014)
    } else {
      part('rocks', sphere, '#acb6a0', 0, 0.04, 0, 0.04 + random() * 0.06, 0.06, 0.045 + random() * 0.06)
    }
  }
  // A cottage, stepping stones, a picnic grove and bridges make each side distinct.
  place(cottageN, 0.15)
  part('house', box, '#f2dec0', 0, 0.22, 0, 0.48, 0.42, 0.4)
  part('roof', cone, '#b7694b', 0, 0.55, 0, 0.45, 0.35, 0.4, 0, Math.PI / 4)
  part('door', box, '#916842', 0, 0.12, 0.208, 0.12, 0.25, 0.025)
  for (const x of [-0.15, 0.15]) part('window', box, '#8abfbb', x, 0.27, 0.21, 0.09, 0.11, 0.026)
  part('chimney', box, '#e0bd92', 0.2, 0.57, -0.08, 0.09, 0.28, 0.09)
  for (let i = 0; i < 6; i++) part('rocks', sphere, '#d3c5a1', Math.sin(i * 0.6) * 0.07, 0.012 - i * 0.008, 0.34 + i * 0.10, 0.07, 0.027, 0.048)
  for (const lat of [-0.30, 0.61]) {
    const lon = 0.18 + 0.27 * Math.sin(lat * 3.8) + 0.08 * Math.sin(lat * 10)
    place(direction(lat, lon), Math.PI / 2)
    for (let i = 0; i < 12; i++) part('bridge', box, i % 2 ? '#bf9463' : '#d5ac79', 0, 0.2 + Math.sin(i / 11 * Math.PI) * 0.08, (i - 5.5) * 0.058, 0.29, 0.055, 0.054)
    for (const x of [-0.17, 0.17]) {
      for (const z of [-0.3, 0, 0.3]) part('wood', cylinder, '#aa774c', x, 0.3, z, 0.024, 0.30, 0.024)
      part('bridge', box, '#c89a62', x, 0.43, 0, 0.026, 0.027, 0.67)
    }
  }
  for (let i = 0; i < 38; i++) {
    const n = normals[Math.floor(random() * normals.length)]!.clone().add(new THREE.Vector3(0.03, 0.005, 0.01)).normalize()
    if (waterDistance(n) < 0.04) continue
    place(n)
    part('stem', cylinder, '#e5d5b4', 0, 0.047, 0, 0.018, 0.094, 0.018)
    part('mushroom', sphere, '#ce7954', 0, 0.094, 0, 0.063, 0.035, 0.063)
    for (let j = 0; j < 3; j++) part('petals', sphere, '#fff1d1', (random() - 0.5) * 0.065, 0.125, (random() - 0.5) * 0.065, 0.008, 0.005, 0.008)
  }
  place(direction(-0.25, -0.5), -0.4)
  part('picnic', box, '#e6bb89', 0, 0.015, 0, 0.4, 0.02, 0.31)
  for (let i = 0; i < 4; i++) part('picnic', box, '#efddba', (i - 1.5) * 0.1, 0.027, 0, 0.04, 0.008, 0.30)
  part('basket', box, '#a77b4b', 0.08, 0.07, 0.06, 0.11, 0.10, 0.09)
  // Fine highlights lie on the river, rather than a repeating water texture.
  for (let i = 0; i < 380; i++) {
    const n = direction(Math.asin(random() * 2 - 1), random() * Math.PI * 2)
    if (waterDistance(n) > -0.012) continue
    place(n, 0)
    part('ripples', sphere, '#b5e5dd', 0, 4.762 - radius(n), 0, 0.025 + random() * 0.06, 0.003, 0.009)
  }
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length)
    batch.matrices.forEach((matrix, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, batch.colors[i]!) })
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); planet.add(mesh)
  }
  const meetingRingPoints: THREE.Vector3[] = []
  const meetingRight = new THREE.Vector3().crossVectors(up, meetingCenter).normalize(), meetingForward = new THREE.Vector3().crossVectors(meetingCenter, meetingRight).normalize()
  for (let i = 0; i < 96; i++) { const angle = i / 96 * Math.PI * 2; const n = meetingCenter.clone().addScaledVector(meetingRight, Math.cos(angle) * 0.34).addScaledVector(meetingForward, Math.sin(angle) * 0.34).normalize(); meetingRingPoints.push(n.multiplyScalar(4.93)) }
  const meetingRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(meetingRingPoints), new THREE.LineBasicMaterial({ color: '#e5d4a0', transparent: true, opacity: 0.8 })); planet.add(meetingRing)
  let fittedDistance = 21
  function fit(reset = false) {
    const width = stage.clientWidth, height = stage.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix()
    const limitingFov = Math.min(THREE.MathUtils.degToRad(camera.fov), 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect))
    const distance = 6.55 / Math.sin(limitingFov / 2)
    const ratio = camera.position.length() / fittedDistance
    fittedDistance = distance; controls.maxDistance = Math.max(distance * 1.7, 38)
    if (reset) camera.position.set(-0.10, 0.2, 1).normalize().multiplyScalar(distance)
    else camera.position.normalize().multiplyScalar(THREE.MathUtils.clamp(distance * ratio, controls.minDistance, controls.maxDistance))
    controls.update()
  }
  camera.position.set(0, 0, 21); fit(true)
  const resizeObserver = new ResizeObserver(() => fit()); resizeObserver.observe(stage)
  const click = (event: Event) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset.action
    if (action) residents.returnToGlobe()
    if (action === 'reset') fit(true)
    else if (action === 'in' || action === 'out') { camera.position.setLength(THREE.MathUtils.clamp(camera.position.length() * (action === 'in' ? 0.85 : 1.18), controls.minDistance, controls.maxDistance)); controls.update() }
  }
  root.addEventListener('click', click)
  const unregister = registerCaptureProvider({ isAvailable: () => !root.hidden, draw: (target, width, height) => {
    renderer.render(scene, camera); target.fillStyle = '#edf0db'; target.fillRect(0, 0, width, height); target.drawImage(renderer.domElement, 0, 0, width, height)
  } })
  const residents = setupForestResidents({
    root, scene, planet, camera, surface: renderer.domElement, controls, terrain, meetingCenter, radius,
    walkable: n => waterDistance(n) > 0.052 && n.distanceTo(cottageN) > 0.13 && normals.every(tree => tree.distanceTo(n) > 0.062),
    enableControls: enabled => { controls.enabled = enabled },
  })
  let lastFrame = performance.now()
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = (now - lastFrame) / 1000; lastFrame = now
    if (!document.hidden && !root.hidden) { if (controls.enabled) controls.update(); residents.update(dt); renderer.render(scene, camera) }
  })
  return {
    resize: () => fit(),
    dispose: () => {
      renderer.setAnimationLoop(null); residents.dispose(); resizeObserver.disconnect(); controls.dispose(); unregister(); root.removeEventListener('click', click)
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>()
      scene.traverse(item => { if (item instanceof THREE.Mesh) { geometries.add(item.geometry); for (const material of Array.isArray(item.material) ? item.material : [item.material]) materials.add(material); if (item instanceof THREE.InstancedMesh) item.dispose() } })
      geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); texture.dispose(); meetingRing.geometry.dispose(); (meetingRing.material as THREE.Material).dispose(); sun.shadow.dispose(); renderer.dispose(); root.replaceChildren()
    },
  }
}
