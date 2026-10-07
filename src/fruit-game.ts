import * as THREE from 'three'
import { registerCaptureProvider } from './capture-controller'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

type FruitGameState = 'ready' | 'playing' | 'paused' | 'gameover'

interface FruitStyle {
  name: string
  skin: number
  flesh: number
  juice: number
  seed: number
  scale: [number, number, number]
  roughness: number
}

interface FlyingFruit {
  group: THREE.Group
  hitMesh: THREE.Mesh
  style: FruitStyle
  velocity: THREE.Vector3
  spin: THREE.Vector3
  rub: number
  entered: boolean
}

interface FruitHalf {
  group: THREE.Group
  hitMesh: THREE.Mesh
  style: FruitStyle
  velocity: THREE.Vector3
  spin: THREE.Vector3
  rub: number
  sliceable: boolean
}

type SliceTarget = FlyingFruit | FruitHalf

interface JuiceDrop {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
}

interface TrailPoint {
  position: THREE.Vector3
  life: number
}

interface BladeStroke {
  group: THREE.Group
  materials: THREE.MeshBasicMaterial[]
  life: number
  maxLife: number
}

interface FruitRecord {
  name: string
  score: number
  combo: number
  sliced: number
  playedAt: string
}

export interface FruitGameController {
  resize: () => void
}

const FRUIT_STYLES: FruitStyle[] = [
  { name: '사과', skin: 0xf45f6f, flesh: 0xffe9bf, juice: 0xff8b8f, seed: 0x6b3b2c, scale: [1, 0.93, 0.96], roughness: 0.48 },
  { name: '오렌지', skin: 0xffa333, flesh: 0xffc24e, juice: 0xffa21f, seed: 0xffe5aa, scale: [1, 1, 1], roughness: 0.7 },
  { name: '수박', skin: 0x4fbd78, flesh: 0xff6680, juice: 0xff5e7b, seed: 0x392f38, scale: [1.13, 0.94, 1], roughness: 0.6 },
  { name: '키위', skin: 0xb48a58, flesh: 0x9ad75f, juice: 0x9dd864, seed: 0x302b24, scale: [0.95, 1.08, 0.95], roughness: 0.92 },
  { name: '레몬', skin: 0xffdc52, flesh: 0xffef8a, juice: 0xffdc55, seed: 0xceb567, scale: [1.2, 0.78, 0.8], roughness: 0.58 },
  { name: '복숭아', skin: 0xff9d91, flesh: 0xffd0a7, juice: 0xff9e8f, seed: 0x8f4d3d, scale: [1.02, 0.96, 1], roughness: 0.82 },
]

const clamp = THREE.MathUtils.clamp

export function setupFruitGame(container: HTMLElement, isActive: () => boolean): FruitGameController {
  const canvas = container.querySelector<HTMLCanvasElement>('#fruitCanvas')!
  const stage = container.querySelector<HTMLElement>('#fruitStage')!
  const scoreElement = container.querySelector<HTMLElement>('#fruitScore')!
  const comboElement = container.querySelector<HTMLElement>('#fruitCombo')!
  const timeElement = container.querySelector<HTMLElement>('#fruitTime')!
  const livesElement = container.querySelector<HTMLElement>('#fruitLives')!
  const introElement = container.querySelector<HTMLElement>('#fruitIntro')!
  const gameOverElement = container.querySelector<HTMLElement>('#fruitGameOver')!
  const finalScoreElement = container.querySelector<HTMLElement>('#fruitFinalScore')!
  const bestComboElement = container.querySelector<HTMLElement>('#fruitBestCombo')!
  const startButton = container.querySelector<HTMLButtonElement>('#fruitStartButton')!
  const restartButton = container.querySelector<HTMLButtonElement>('#fruitRestartButton')!
  const scoreForm = container.querySelector<HTMLFormElement>('#fruitScoreForm')!
  const playerNameInput = container.querySelector<HTMLInputElement>('#fruitPlayerName')!
  const scoreSavedElement = container.querySelector<HTMLElement>('#fruitScoreSaved')!
  const recordsButton = container.querySelector<HTMLButtonElement>('#fruitRecordsButton')!
  const scoreDrawer = container.querySelector<HTMLElement>('#fruitScoreDrawer')!
  const closeScoreDrawerButton = container.querySelector<HTMLButtonElement>('#closeFruitScoreDrawer')!
  const recordBestElement = container.querySelector<HTMLElement>('#fruitRecordBest')!
  const recordListElement = container.querySelector<HTMLOListElement>('#fruitRecordList')!

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const environmentGenerator = new THREE.PMREMGenerator(renderer)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xffe2b9)
  scene.fog = new THREE.Fog(0xffd8b5, 15, 26)
  scene.environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50)
  registerCaptureProvider({
    isAvailable: isActive,
    draw: (target, width, height) => {
      renderer.render(scene, camera)
      target.drawImage(renderer.domElement, 0, 0, width, height)
    },
  })
  camera.position.set(0, 0.2, 12)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.HemisphereLight(0xfff8de, 0xd47f75, 2.6))
  const keyLight = new THREE.DirectionalLight(0xffffff, 4.6)
  keyLight.position.set(-4, 7, 8)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(1024, 1024)
  keyLight.shadow.camera.left = -8
  keyLight.shadow.camera.right = 8
  keyLight.shadow.camera.top = 8
  keyLight.shadow.camera.bottom = -8
  scene.add(keyLight)

  const rimLight = new THREE.PointLight(0xff7189, 24, 16, 2)
  rimLight.position.set(5, 2, 4)
  scene.add(rimLight)

  const glossLight = new THREE.PointLight(0xffffff, 18, 12, 2)
  glossLight.position.set(-3.5, 0.5, 7)
  scene.add(glossLight)

  const background = new THREE.Group()
  scene.add(background)
  const backdropMaterial = new THREE.MeshBasicMaterial({ color: 0xffcb9e })
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(32, 20), backdropMaterial)
  backdrop.position.z = -3.4
  background.add(backdrop)

  const glowColors = [0xff7d83, 0xffd45f, 0x80d7a4, 0x76cfe8, 0xc29ae9]
  glowColors.forEach((color, index) => {
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(1.7 + (index % 2) * 0.5, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }),
    )
    glow.position.set(-7 + index * 3.5, index % 2 ? 3.3 : -2.8, -3.15)
    background.add(glow)
  })

  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(18, 1.25, 2.1),
    new THREE.MeshStandardMaterial({ color: 0xf4a079, roughness: 0.86 }),
  )
  counter.position.set(0, -5.45, -0.8)
  counter.receiveShadow = true
  scene.add(counter)

  const trailGeometry = new THREE.BufferGeometry()
  const trailPositions = new Float32Array(64 * 3)
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
  const trailMaterial = new THREE.PointsMaterial({
    color: 0xbdf6ff,
    size: 0.075,
    transparent: true,
    opacity: 0.92,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const trailMesh = new THREE.Points(trailGeometry, trailMaterial)
  trailMesh.renderOrder = 20
  scene.add(trailMesh)

  const raycaster = new THREE.Raycaster()
  const fruits: FlyingFruit[] = []
  const halves: FruitHalf[] = []
  const juiceDrops: JuiceDrop[] = []
  const trailPoints: TrailPoint[] = []
  const bladeStrokes: BladeStroke[] = []
  const juiceSphere = new THREE.SphereGeometry(1, 10, 8)
  const skinTextures = new Map<string, THREE.CanvasTexture>()
  const fleshTextures = new Map<string, THREE.CanvasTexture>()
  const SCORE_STORAGE_KEY = 'playroom-fruit-scores-v1'

  let state: FruitGameState = 'ready'
  let score = 0
  let combo = 1
  let bestCombo = 1
  let lives = 3
  let elapsed = 0
  let spawnClock = 0
  let lastSliceAt = -10
  let gestureSliceCount = 0
  let slicedCount = 0
  let pointerActive = false
  let previousPointer = new THREE.Vector2()
  let previousTime = performance.now()
  let records: FruitRecord[] = loadRecords()
  let stateBeforeDrawer: FruitGameState = 'ready'

  function worldBounds(): { halfWidth: number; halfHeight: number } {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.position.z
    return { halfHeight, halfWidth: halfHeight * camera.aspect }
  }

  function colorCss(color: THREE.Color): string {
    return `#${color.getHexString()}`
  }

  function skinTexture(style: FruitStyle): THREE.CanvasTexture {
    const existing = skinTextures.get(style.name)
    if (existing) return existing
    const textureCanvas = document.createElement('canvas')
    textureCanvas.width = 256
    textureCanvas.height = 256
    const context = textureCanvas.getContext('2d')!
    const base = new THREE.Color(style.skin)
    const light = base.clone().offsetHSL(-0.015, -0.03, 0.16)
    const shade = base.clone().offsetHSL(0.012, 0.04, -0.14)
    const gradient = context.createRadialGradient(76, 58, 8, 138, 138, 188)
    gradient.addColorStop(0, colorCss(light))
    gradient.addColorStop(0.55, colorCss(base))
    gradient.addColorStop(1, colorCss(shade))
    context.fillStyle = gradient
    context.fillRect(0, 0, 256, 256)

    if (style.name === '수박') {
      context.lineWidth = 18
      context.strokeStyle = 'rgba(26, 101, 65, .68)'
      for (let stripe = -1; stripe < 7; stripe += 1) {
        const x = stripe * 44
        context.beginPath()
        context.moveTo(x, -8)
        context.bezierCurveTo(x + 25, 58, x - 22, 128, x + 12, 264)
        context.stroke()
      }
    } else {
      const poreCount = style.name === '오렌지' || style.name === '레몬' ? 820 : style.name === '키위' ? 1100 : 260
      for (let index = 0; index < poreCount; index += 1) {
        const x = Math.random() * 256
        const y = Math.random() * 256
        const radius = style.name === '키위' ? Math.random() * 0.9 + 0.25 : Math.random() * 1.25 + 0.3
        context.fillStyle = index % 3 === 0 ? 'rgba(255,255,255,.13)' : 'rgba(70,35,24,.10)'
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fill()
        if (style.name === '키위' && index % 4 === 0) {
          context.strokeStyle = 'rgba(73,44,24,.18)'
          context.lineWidth = 0.45
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x + Math.random() * 4 - 2, y + Math.random() * 5 - 2.5)
          context.stroke()
        }
      }
    }

    const texture = new THREE.CanvasTexture(textureCanvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    skinTextures.set(style.name, texture)
    return texture
  }

  function fleshTexture(style: FruitStyle): THREE.CanvasTexture {
    const existing = fleshTextures.get(style.name)
    if (existing) return existing
    const textureCanvas = document.createElement('canvas')
    textureCanvas.width = 256
    textureCanvas.height = 256
    const context = textureCanvas.getContext('2d')!
    const base = new THREE.Color(style.flesh)
    const center = base.clone().offsetHSL(0, -0.06, 0.14)
    const edge = base.clone().offsetHSL(0, 0.04, -0.09)
    const gradient = context.createRadialGradient(112, 92, 8, 128, 128, 126)
    gradient.addColorStop(0, colorCss(center))
    gradient.addColorStop(0.7, colorCss(base))
    gradient.addColorStop(1, colorCss(edge))
    context.fillStyle = gradient
    context.fillRect(0, 0, 256, 256)
    context.translate(128, 128)
    context.strokeStyle = 'rgba(255,255,255,.16)'
    context.lineWidth = 1.3
    for (let index = 0; index < 42; index += 1) {
      const angle = (index / 42) * Math.PI * 2
      context.beginPath()
      context.moveTo(Math.cos(angle) * 15, Math.sin(angle) * 15)
      context.lineTo(Math.cos(angle) * 118, Math.sin(angle) * 118)
      context.stroke()
    }
    const texture = new THREE.CanvasTexture(textureCanvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    fleshTextures.set(style.name, texture)
    return texture
  }

  function fruitGeometry(style: FruitStyle): THREE.SphereGeometry {
    const geometry = new THREE.SphereGeometry(0.72, 48, 34)
    const position = geometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < position.count; index += 1) {
      let x = position.getX(index)
      let y = position.getY(index)
      let z = position.getZ(index)
      const nx = x / 0.72
      const ny = y / 0.72
      const nz = z / 0.72

      if (style.name === '사과') {
        const middleBulge = 1 + 0.1 * (1 - ny * ny) - 0.075 * Math.pow(Math.abs(ny), 5)
        const lobes = 1 + Math.cos(Math.atan2(z, x) * 5) * 0.018 * (0.35 + Math.abs(ny))
        x *= middleBulge * lobes
        z *= middleBulge * lobes
        if (ny > 0.72) y -= (ny - 0.72) * 0.13
      } else if (style.name === '오렌지' || style.name === '키위') {
        const textureNoise = Math.sin(nx * 39 + ny * 17) * Math.sin(nz * 31 - ny * 23) * 0.006
        x *= 1 + textureNoise
        y *= 1 + textureNoise
        z *= 1 + textureNoise
      } else if (style.name === '레몬') {
        const taper = 1 - Math.pow(Math.abs(nx), 5) * 0.13
        y *= taper
        z *= taper
        x *= 1 + Math.pow(Math.abs(nx), 8) * 0.055
      } else if (style.name === '복숭아') {
        const softBulge = 1 + 0.055 * (1 - ny * ny)
        x *= softBulge
        z *= softBulge
        if (ny > 0.68) y -= (ny - 0.68) * 0.08
      }
      position.setXYZ(index, x, y, z)
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()
    return geometry
  }

  function makeFruit(): FlyingFruit {
    const style = FRUIT_STYLES[Math.floor(Math.random() * FRUIT_STYLES.length)]
    const group = new THREE.Group()
    const skinMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: skinTexture(style),
      roughness: style.roughness,
      metalness: 0,
      clearcoat: style.name === '키위' ? 0.1 : 0.72,
      clearcoatRoughness: style.name === '오렌지' || style.name === '레몬' ? 0.42 : 0.19,
      reflectivity: 0.68,
      sheen: style.name === '복숭아' || style.name === '키위' ? 0.5 : 0.12,
      sheenColor: new THREE.Color(style.skin).offsetHSL(0, -0.08, 0.18),
    })
    const fruitMesh = new THREE.Mesh(fruitGeometry(style), skinMaterial)
    fruitMesh.scale.set(...style.scale)
    fruitMesh.castShadow = true
    group.add(fruitMesh)

    if (style.name === '복숭아') {
      const groove = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.018, 8, 36, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0xd96f75, roughness: 0.8 }),
      )
      groove.rotation.z = Math.PI / 2
      groove.position.z = 0.035
      group.add(groove)
    }

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.06, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x6f5530, roughness: 0.92 }),
    )
    stem.position.y = 0.72 * style.scale[1] + 0.1
    stem.rotation.z = -0.12
    stem.castShadow = true
    group.add(stem)

    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 14, 8),
      new THREE.MeshStandardMaterial({ color: 0x4b9b62, roughness: 0.82 }),
    )
    leaf.scale.set(1.45, 0.28, 0.72)
    leaf.position.set(0.14, stem.position.y + 0.06, 0)
    leaf.rotation.z = -0.38
    leaf.castShadow = true
    group.add(leaf)

    const bounds = worldBounds()
    const x = THREE.MathUtils.randFloat(-bounds.halfWidth * 0.72, bounds.halfWidth * 0.72)
    const z = THREE.MathUtils.randFloat(-0.45, 1.15)
    group.position.set(x, -bounds.halfHeight - 1.15, z)
    group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)

    const fruit: FlyingFruit = {
      group,
      hitMesh: fruitMesh,
      style,
      velocity: new THREE.Vector3(-x * 0.22 + THREE.MathUtils.randFloat(-1.2, 1.2), THREE.MathUtils.randFloat(10.8, 13.2), 0),
      spin: new THREE.Vector3(
        THREE.MathUtils.randFloat(-2.1, 2.1),
        THREE.MathUtils.randFloat(-2.4, 2.4),
        THREE.MathUtils.randFloat(-2.2, 2.2),
      ),
      rub: 0,
      entered: false,
    }
    fruitMesh.userData.sliceTarget = fruit
    scene.add(group)
    fruits.push(fruit)
    return fruit
  }

  function makeHalf(style: FruitStyle, side: -1 | 1): { group: THREE.Group; hitMesh: THREE.Mesh } {
    const group = new THREE.Group()
    const phiStart = side < 0 ? 0 : Math.PI
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 40, 28, phiStart, Math.PI),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: skinTexture(style),
        roughness: style.roughness,
        clearcoat: style.name === '키위' ? 0.08 : 0.58,
        clearcoatRoughness: 0.24,
        side: THREE.DoubleSide,
      }),
    )
    shell.castShadow = true
    group.add(shell)

    const rind = new THREE.Mesh(
      new THREE.CircleGeometry(0.708, 48),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(style.skin).offsetHSL(0, -0.12, 0.16),
        roughness: 0.7,
        clearcoat: 0.2,
        side: THREE.DoubleSide,
      }),
    )
    rind.position.z = side * 0.01
    if (side < 0) rind.rotation.y = Math.PI
    group.add(rind)

    const cutFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.655, 48),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: fleshTexture(style),
        roughness: 0.46,
        clearcoat: 0.48,
        clearcoatRoughness: 0.2,
        transmission: 0.03,
        side: THREE.DoubleSide,
      }),
    )
    cutFace.position.z = side * 0.025
    if (side < 0) cutFace.rotation.y = Math.PI
    group.add(cutFace)

    const seedCount = style.name === '수박' ? 8 : style.name === '키위' ? 12 : 4
    for (let index = 0; index < seedCount; index += 1) {
      const angle = (index / seedCount) * Math.PI * 2 + 0.3
      const radius = style.name === '키위' ? 0.4 : 0.27 + (index % 2) * 0.13
      const seed = new THREE.Mesh(
        new THREE.SphereGeometry(style.name === '키위' ? 0.022 : 0.035, 9, 7),
        new THREE.MeshStandardMaterial({ color: style.seed, roughness: 0.8 }),
      )
      seed.scale.set(0.65, 1.35, 0.35)
      seed.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, side * 0.032)
      group.add(seed)
    }
    const hitProxy = new THREE.Mesh(
      new THREE.SphereGeometry(0.66, 14, 10),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    )
    group.add(hitProxy)
    group.scale.set(...style.scale)
    return { group, hitMesh: hitProxy }
  }

  function sprayJuice(position: THREE.Vector3, style: FruitStyle, swipe: THREE.Vector2): void {
    const tangent = new THREE.Vector2(swipe.x, -swipe.y).normalize()
    for (let index = 0; index < 22; index += 1) {
      const size = THREE.MathUtils.randFloat(0.035, 0.11)
      const material = new THREE.MeshPhysicalMaterial({
        color: style.juice,
        emissive: style.juice,
        emissiveIntensity: 0.18,
        transparent: true,
        opacity: 0.94,
        roughness: 0.25,
      })
      const mesh = new THREE.Mesh(juiceSphere, material)
      mesh.scale.set(size, size * THREE.MathUtils.randFloat(0.7, 1.55), size)
      mesh.position.copy(position)
      mesh.position.z += THREE.MathUtils.randFloat(0.2, 1)
      mesh.renderOrder = 10
      scene.add(mesh)
      const side = index % 2 === 0 ? 1 : -1
      const speed = THREE.MathUtils.randFloat(1.8, 5.6)
      juiceDrops.push({
        mesh,
        velocity: new THREE.Vector3(
          tangent.y * side * speed + THREE.MathUtils.randFloat(-1.1, 1.1),
          -tangent.x * side * speed + THREE.MathUtils.randFloat(-0.5, 2.4),
          THREE.MathUtils.randFloat(0.4, 3.4),
        ),
        life: THREE.MathUtils.randFloat(0.55, 1.05),
        maxLife: 1.05,
      })
    }
  }

  function removeFruit(fruit: FlyingFruit): void {
    const index = fruits.indexOf(fruit)
    if (index >= 0) fruits.splice(index, 1)
    scene.remove(fruit.group)
  }

  function splitFruit(fruit: FlyingFruit, swipe: THREE.Vector2): void {
    if (!fruits.includes(fruit)) return
    const position = fruit.group.position.clone()
    const zRotation = Math.atan2(-swipe.y, swipe.x)
    removeFruit(fruit)

    const normal = new THREE.Vector2(-swipe.y, swipe.x).normalize()
    ;([-1, 1] as const).forEach((side) => {
      const halfVisual = makeHalf(fruit.style, side)
      const group = halfVisual.group
      group.position.copy(position)
      group.rotation.set(0.1 * side, 0, zRotation)
      scene.add(group)
      const half: FruitHalf = {
        group,
        hitMesh: halfVisual.hitMesh,
        style: fruit.style,
        velocity: new THREE.Vector3(
          fruit.velocity.x + normal.x * side * 2.5,
          fruit.velocity.y + normal.y * side * 2.5 - 0.4,
          side * 0.65,
        ),
        spin: new THREE.Vector3(THREE.MathUtils.randFloat(-2.8, 2.8), side * 2.2, side * 2.8),
        rub: 0,
        sliceable: true,
      }
      halfVisual.hitMesh.userData.sliceTarget = half
      halves.push(half)
    })

    sprayJuice(position, fruit.style, swipe)
  }

  function removeHalf(half: FruitHalf): void {
    const index = halves.indexOf(half)
    if (index >= 0) halves.splice(index, 1)
    scene.remove(half.group)
  }

  function splitHalf(half: FruitHalf, swipe: THREE.Vector2): void {
    if (!half.sliceable || !halves.includes(half)) return
    const position = half.group.position.clone()
    const normal = new THREE.Vector2(-swipe.y, swipe.x).normalize()
    removeHalf(half)

    ;([-1, 1] as const).forEach((side) => {
      const chunkVisual = makeHalf(half.style, side)
      const group = chunkVisual.group
      group.scale.multiplyScalar(0.62)
      group.position.copy(position)
      group.position.x += normal.x * side * 0.12
      group.position.y += normal.y * side * 0.12
      group.rotation.copy(half.group.rotation)
      group.rotation.z += side * 0.34
      scene.add(group)
      halves.push({
        group,
        hitMesh: chunkVisual.hitMesh,
        style: half.style,
        velocity: new THREE.Vector3(
          half.velocity.x + normal.x * side * 2.25,
          half.velocity.y + normal.y * side * 2.25,
          side * 1.15,
        ),
        spin: new THREE.Vector3(THREE.MathUtils.randFloat(-3.8, 3.8), side * 3.1, side * 3.6),
        rub: 0,
        sliceable: false,
      })
    })
    sprayJuice(position, half.style, swipe)
  }

  function splitTarget(target: SliceTarget, swipe: THREE.Vector2): void {
    if ('entered' in target) splitFruit(target, swipe)
    else splitHalf(target, swipe)
  }

  function sliceBatch(targets: SliceTarget[], swipe: THREE.Vector2): void {
    const validTargets = targets.filter((target) => ('entered' in target ? fruits.includes(target) : target.sliceable && halves.includes(target)))
    if (validTargets.length === 0) return
    if (elapsed - lastSliceAt > 0.42) gestureSliceCount = 0
    validTargets.forEach((target) => splitTarget(target, swipe))
    const fruitCount = validTargets.length
    const previousGesturePoints = 10 * gestureSliceCount * gestureSliceCount
    gestureSliceCount += fruitCount
    const gesturePoints = 10 * gestureSliceCount * gestureSliceCount
    const awardedPoints = gesturePoints - previousGesturePoints
    combo = gestureSliceCount
    bestCombo = Math.max(bestCombo, combo)
    lastSliceAt = elapsed
    slicedCount += fruitCount
    score += awardedPoints
    updateHud()
    stage.classList.remove('fruit-sliced')
    void stage.offsetWidth
    stage.classList.add('fruit-sliced')
  }

  function updateHud(): void {
    scoreElement.textContent = String(score).padStart(3, '0')
    comboElement.textContent = `×${combo}`
    const seconds = Math.floor(elapsed)
    timeElement.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    livesElement.textContent = Array.from({ length: 3 }, (_, index) => (index < lives ? '●' : '○')).join(' ')
  }

  function clearGameObjects(): void {
    fruits.splice(0).forEach((fruit) => scene.remove(fruit.group))
    halves.splice(0).forEach((half) => scene.remove(half.group))
    juiceDrops.splice(0).forEach((drop) => scene.remove(drop.mesh))
    bladeStrokes.splice(0).forEach((stroke) => scene.remove(stroke.group))
    trailPoints.length = 0
    trailGeometry.setDrawRange(0, 0)
  }

  function loadRecords(): FruitRecord[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCORE_STORAGE_KEY) ?? '[]') as FruitRecord[]
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((record) => Number.isFinite(record.score) && Number.isFinite(record.combo) && Number.isFinite(record.sliced))
        .map((record) => ({ ...record, name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 10) : 'PLAYER' }))
        .sort((a, b) => b.score - a.score || b.combo - a.combo)
        .slice(0, 5)
    } catch {
      return []
    }
  }

  function renderRecords(): void {
    recordListElement.innerHTML = ''
    recordBestElement.textContent = String(records[0]?.score ?? 0).padStart(3, '0')
    if (records.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'empty'
      empty.textContent = '아직 기록이 없어요. 첫 기록을 만들어보세요!'
      recordListElement.append(empty)
      return
    }
    records.forEach((record, index) => {
      const item = document.createElement('li')
      const rank = document.createElement('strong')
      rank.textContent = String(index + 1).padStart(2, '0')
      const details = document.createElement('span')
      const scoreLabel = document.createElement('b')
      scoreLabel.textContent = `${record.name} · ${record.score.toLocaleString('ko-KR')}점`
      const meta = document.createElement('small')
      meta.textContent = `${record.playedAt} · ${record.sliced}개 · 최고 ×${record.combo}`
      details.append(scoreLabel, meta)
      item.append(rank, details)
      recordListElement.append(item)
    })
  }

  function saveRecord(playerName: string): void {
    const playedAt = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(new Date())
    records = [...records, { name: playerName, score, combo: bestCombo, sliced: slicedCount, playedAt }]
      .sort((a, b) => b.score - a.score || b.combo - a.combo)
      .slice(0, 5)
    try {
      localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(records))
    } catch {
      // The game still works when storage is blocked by the browser.
    }
    renderRecords()
  }

  function setScoreDrawer(open: boolean): void {
    if (open && !scoreDrawer.hidden) return
    if (!open && scoreDrawer.hidden) return
    if (open) {
      stateBeforeDrawer = state
      if (state === 'playing') state = 'paused'
      renderRecords()
    } else if (state === 'paused') {
      state = stateBeforeDrawer === 'playing' ? 'playing' : stateBeforeDrawer
    }
    scoreDrawer.hidden = !open
    recordsButton.setAttribute('aria-expanded', String(open))
    if (open) closeScoreDrawerButton.focus()
  }

  function startGame(): void {
    clearGameObjects()
    state = 'playing'
    score = 0
    combo = 1
    bestCombo = 1
    lives = 3
    elapsed = 0
    spawnClock = 0.35
    lastSliceAt = -10
    gestureSliceCount = 0
    slicedCount = 0
    pointerActive = false
    introElement.hidden = true
    gameOverElement.hidden = true
    scoreForm.hidden = false
    scoreSavedElement.hidden = true
    restartButton.hidden = true
    playerNameInput.value = ''
    setScoreDrawer(false)
    updateHud()
    makeFruit()
  }

  function finishGame(): void {
    state = 'gameover'
    pointerActive = false
    stage.classList.remove('blade-active')
    finalScoreElement.textContent = String(score)
    bestComboElement.textContent = `×${bestCombo}`
    gameOverElement.hidden = false
    requestAnimationFrame(() => playerNameInput.focus())
  }

  function pointerCoordinates(event: PointerEvent): THREE.Vector2 {
    const rect = canvas.getBoundingClientRect()
    return new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top)
  }

  function screenToNdc(point: THREE.Vector2): THREE.Vector2 {
    const rect = canvas.getBoundingClientRect()
    return new THREE.Vector2((point.x / rect.width) * 2 - 1, -(point.y / rect.height) * 2 + 1)
  }

  function pointOnTrailPlane(ndc: THREE.Vector2): THREE.Vector3 {
    raycaster.setFromCamera(ndc, camera)
    const distance = (3.2 - raycaster.ray.origin.z) / raycaster.ray.direction.z
    return raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, distance)
  }

  function bladeRibbon(
    start: THREE.Vector3,
    end: THREE.Vector3,
    width: number,
    color: number,
    opacity: number,
    zOffset: number,
  ): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
    const direction = end.clone().sub(start)
    const normal = new THREE.Vector3(-direction.y, direction.x, 0).normalize()
    const startWidth = width * 0.5
    const tipWidth = width * 0.16
    const vertices = new Float32Array([
      start.x + normal.x * startWidth, start.y + normal.y * startWidth, start.z + zOffset,
      start.x - normal.x * startWidth, start.y - normal.y * startWidth, start.z + zOffset,
      end.x + normal.x * tipWidth, end.y + normal.y * tipWidth, end.z + zOffset,
      end.x - normal.x * tipWidth, end.y - normal.y * tipWidth, end.z + zOffset,
    ])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geometry.setIndex([0, 1, 2, 1, 3, 2])
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 24
    return { mesh, material }
  }

  function addBladeStroke(from: THREE.Vector2, to: THREE.Vector2, pixelDistance: number): void {
    const start = pointOnTrailPlane(screenToNdc(from))
    const end = pointOnTrailPlane(screenToNdc(to))
    if (start.distanceToSquared(end) < 0.001) return
    const width = clamp(pixelDistance / 720, 0.022, 0.065)
    const group = new THREE.Group()
    const glow = bladeRibbon(start, end, width * 2.1, 0x79e8ff, 0.2, -0.018)
    const blade = bladeRibbon(start, end, width, 0xffffff, 1, 0.02)
    group.add(glow.mesh, blade.mesh)
    scene.add(group)
    bladeStrokes.push({ group, materials: [glow.material, blade.material], life: 0.14, maxLife: 0.14 })
    if (bladeStrokes.length > 22) {
      const oldStroke = bladeStrokes.shift()
      if (oldStroke) scene.remove(oldStroke.group)
    }
  }

  function rubBetween(from: THREE.Vector2, to: THREE.Vector2): void {
    const distance = from.distanceTo(to)
    if (distance < 1) return
    addBladeStroke(from, to, distance)
    const steps = Math.max(1, Math.ceil(distance / 9))
    const touched = new Set<SliceTarget>()

    for (let index = 1; index <= steps; index += 1) {
      const point = from.clone().lerp(to, index / steps)
      const ndc = screenToNdc(point)

      raycaster.setFromCamera(ndc, camera)
      const sliceMeshes = [
        ...fruits.map((fruit) => fruit.hitMesh),
        ...halves.filter((half) => half.sliceable).map((half) => half.hitMesh),
      ]
      const hit = raycaster.intersectObjects(sliceMeshes, false)[0]
      const target = hit?.object.userData.sliceTarget as SliceTarget | undefined
      if (target) touched.add(target)
    }

    const swipe = to.clone().sub(from)
    const readyToSlice: SliceTarget[] = []
    touched.forEach((target) => {
      target.rub += clamp(distance / 68, 0.12, 0.7)
      const pulse = 1 + Math.sin(target.rub * Math.PI * 5) * 0.035
      if ('entered' in target) target.group.scale.setScalar(pulse)
      if (target.rub >= 0.62) readyToSlice.push(target)
    })
    sliceBatch(readyToSlice, swipe)
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!isActive() || state !== 'playing') return
    pointerActive = true
    gestureSliceCount = 0
    lastSliceAt = -10
    stage.classList.add('blade-active')
    previousPointer = pointerCoordinates(event)
    canvas.setPointerCapture(event.pointerId)
  })

  canvas.addEventListener('pointermove', (event) => {
    if (!pointerActive || state !== 'playing') return
    const next = pointerCoordinates(event)
    rubBetween(previousPointer, next)
    previousPointer = next
  })

  const stopPointer = (event: PointerEvent): void => {
    pointerActive = false
    stage.classList.remove('blade-active')
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  canvas.addEventListener('pointerup', stopPointer)
  canvas.addEventListener('pointercancel', stopPointer)

  startButton.addEventListener('click', startGame)
  restartButton.addEventListener('click', startGame)
  scoreForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const playerName = playerNameInput.value.trim().replace(/\s+/g, ' ').slice(0, 10)
    if (!playerName) {
      playerNameInput.setCustomValidity('이름을 입력해 주세요.')
      playerNameInput.reportValidity()
      return
    }
    playerNameInput.setCustomValidity('')
    saveRecord(playerName)
    scoreForm.hidden = true
    scoreSavedElement.hidden = false
    restartButton.hidden = false
    restartButton.focus()
  })
  playerNameInput.addEventListener('input', () => playerNameInput.setCustomValidity(''))
  recordsButton.addEventListener('click', () => setScoreDrawer(true))
  closeScoreDrawerButton.addEventListener('click', () => setScoreDrawer(false))

  function updateTrail(delta: number): void {
    for (let index = trailPoints.length - 1; index >= 0; index -= 1) {
      trailPoints[index].life -= delta
      if (trailPoints[index].life <= 0) trailPoints.splice(index, 1)
    }
    trailPoints.forEach((point, index) => {
      trailPositions[index * 3] = point.position.x
      trailPositions[index * 3 + 1] = point.position.y
      trailPositions[index * 3 + 2] = point.position.z
    })
    trailGeometry.setDrawRange(0, trailPoints.length)
    trailGeometry.attributes.position.needsUpdate = true
    trailMaterial.opacity = trailPoints.length ? 0.92 : 0
  }

  function updatePlaying(delta: number): void {
    elapsed += delta
    spawnClock += delta
    const spawnInterval = Math.max(0.48, 0.95 - elapsed * 0.0045)
    if (spawnClock >= spawnInterval && fruits.length < 9) {
      spawnClock = 0
      const waveSize = elapsed > 20 && Math.random() < 0.18 ? 3 : elapsed > 7 && Math.random() < 0.42 ? 2 : 1
      for (let index = 0; index < waveSize && fruits.length < 10; index += 1) makeFruit()
    }

    const bounds = worldBounds()
    for (let index = fruits.length - 1; index >= 0; index -= 1) {
      const fruit = fruits[index]
      fruit.velocity.y -= 9.2 * delta
      fruit.group.position.addScaledVector(fruit.velocity, delta)
      fruit.group.rotation.x += fruit.spin.x * delta
      fruit.group.rotation.y += fruit.spin.y * delta
      fruit.group.rotation.z += fruit.spin.z * delta
      fruit.group.scale.lerp(new THREE.Vector3(1, 1, 1), delta * 9)
      if (fruit.group.position.y < bounds.halfHeight - 0.6) fruit.entered = true
      if (fruit.entered && fruit.group.position.y < -bounds.halfHeight - 1.45) {
        removeFruit(fruit)
        lives -= 1
        combo = 1
        gestureSliceCount = 0
        updateHud()
        if (lives <= 0) {
          finishGame()
          break
        }
      }
    }
    updateHud()
  }

  function updateEffects(delta: number): void {
    const bounds = worldBounds()
    for (let index = halves.length - 1; index >= 0; index -= 1) {
      const half = halves[index]
      half.velocity.y -= 9.3 * delta
      half.group.position.addScaledVector(half.velocity, delta)
      half.group.rotation.x += half.spin.x * delta
      half.group.rotation.y += half.spin.y * delta
      half.group.rotation.z += half.spin.z * delta
      if (half.group.position.y < -bounds.halfHeight - 2) {
        scene.remove(half.group)
        halves.splice(index, 1)
      }
    }

    for (let index = juiceDrops.length - 1; index >= 0; index -= 1) {
      const drop = juiceDrops[index]
      drop.life -= delta
      drop.velocity.y -= 5.8 * delta
      drop.mesh.position.addScaledVector(drop.velocity, delta)
      const material = drop.mesh.material as THREE.MeshPhysicalMaterial
      material.opacity = clamp(drop.life / drop.maxLife, 0, 1)
      drop.mesh.scale.multiplyScalar(1 + delta * 0.8)
      if (drop.life <= 0) {
        scene.remove(drop.mesh)
        juiceDrops.splice(index, 1)
      }
    }
    for (let index = bladeStrokes.length - 1; index >= 0; index -= 1) {
      const stroke = bladeStrokes[index]
      stroke.life -= delta
      const progress = clamp(stroke.life / stroke.maxLife, 0, 1)
      stroke.materials[0].opacity = progress * 0.2
      stroke.materials[1].opacity = Math.pow(progress, 1.35)
      if (stroke.life <= 0) {
        scene.remove(stroke.group)
        stroke.group.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose()
        })
        bladeStrokes.splice(index, 1)
      }
    }
    updateTrail(delta)
  }

  function resize(): void {
    const rect = stage.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    const width = Math.floor(rect.width)
    const height = Math.floor(rect.height)
    const pixelRatio = renderer.getPixelRatio()
    if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
  }

  function animate(timestamp: number): void {
    requestAnimationFrame(animate)
    if (!isActive() || document.hidden) {
      previousTime = timestamp
      return
    }
    resize()
    const delta = Math.min((timestamp - previousTime) / 1000, 0.04)
    previousTime = timestamp
    if (state === 'playing') updatePlaying(delta)
    updateEffects(delta)
    background.rotation.z = Math.sin(timestamp * 0.00012) * 0.012
    renderer.render(scene, camera)
  }

  updateHud()
  requestAnimationFrame(animate)
  return { resize }
}
