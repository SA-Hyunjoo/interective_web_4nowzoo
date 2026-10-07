import * as THREE from 'three'
import { registerCaptureProvider } from './capture-controller'
import * as CANNON from 'cannon-es'

type ClawState = 'idle' | 'lowering' | 'closing' | 'lifting' | 'toChute' | 'releasing' | 'dropping' | 'returning'

interface PlushPrize {
  group: THREE.Group
  body: CANNON.Body
  captured: boolean
  unstable: boolean
  name: string
  color: number
  kind: number
}

export interface ClawGameController {
  resize: () => void
}

const clamp = THREE.MathUtils.clamp
const moveTowards = (current: number, target: number, amount: number): number => {
  if (Math.abs(target - current) <= amount) return target
  return current + Math.sign(target - current) * amount
}

export function setupClawGame(container: HTMLElement, isActive: () => boolean): ClawGameController {
  const canvas = container.querySelector<HTMLCanvasElement>('#clawCanvas')!
  const stage = container.querySelector<HTMLElement>('#clawStage')!
  const statusElement = container.querySelector<HTMLElement>('#clawStatus')!
  const celebrationElement = container.querySelector<HTMLElement>('#prizeCelebration')!
  const prizesButton = container.querySelector<HTMLButtonElement>('#prizesButton')!
  const prizeCountElement = container.querySelector<HTMLElement>('#prizeCount')!
  const prizeDrawer = container.querySelector<HTMLElement>('#prizeDrawer')!
  const closePrizeDrawerButton = container.querySelector<HTMLButtonElement>('#closePrizeDrawer')!
  const prizeListElement = container.querySelector<HTMLElement>('#prizeList')!
  const prizeViewerCanvas = container.querySelector<HTMLCanvasElement>('#prizeViewerCanvas')!
  const selectedPrizeName = container.querySelector<HTMLElement>('#selectedPrizeName')!
  const keyIndicators = new Map(
    Array.from(container.querySelectorAll<HTMLElement>('[data-control-key]')).map((element) => [element.dataset.controlKey!, element]),
  )

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xeadfff)
  scene.fog = new THREE.Fog(0xeadfff, 12, 24)

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  registerCaptureProvider({
    isAvailable: isActive,
    draw: (target, width, height) => {
      renderer.render(scene, camera)
      target.drawImage(renderer.domElement, 0, 0, width, height)
    },
  })
  camera.position.set(0, 4.4, 12.2)
  camera.lookAt(0, 3.25, 0)

  scene.add(new THREE.HemisphereLight(0xfffbef, 0x9b8ac4, 2.35))
  const keyLight = new THREE.DirectionalLight(0xffead0, 4.2)
  keyLight.position.set(-5, 9, 7)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(1024, 1024)
  keyLight.shadow.camera.left = -8
  keyLight.shadow.camera.right = 8
  keyLight.shadow.camera.top = 10
  keyLight.shadow.camera.bottom = -4
  scene.add(keyLight)

  const rimLight = new THREE.PointLight(0x93ddff, 26, 14, 2)
  rimLight.position.set(4, 5, -3)
  scene.add(rimLight)

  const machineRoot = new THREE.Group()
  scene.add(machineRoot)

  const pinkMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf3a9c2, roughness: 0.55, metalness: 0.05, clearcoat: 0.42 })
  const darkPinkMaterial = new THREE.MeshStandardMaterial({ color: 0xb69ae8, roughness: 0.5, metalness: 0.12 })
  const creamMaterial = new THREE.MeshPhysicalMaterial({ color: 0xfff7dd, roughness: 0.7, clearcoat: 0.18 })
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xd9e1e7, roughness: 0.24, metalness: 0.82 })
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x231d31, roughness: 0.72 })
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdff7ff,
    transparent: true,
    opacity: 0.14,
    roughness: 0.08,
    transmission: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -7.4, 0) })
  physicsWorld.allowSleep = true
  ;(physicsWorld.solver as CANNON.GSSolver).iterations = 18
  physicsWorld.defaultContactMaterial.friction = 0.72
  physicsWorld.defaultContactMaterial.restitution = 0.03
  physicsWorld.defaultContactMaterial.contactEquationStiffness = 8e7
  physicsWorld.defaultContactMaterial.contactEquationRelaxation = 4

  const addStaticCollider = (halfExtents: CANNON.Vec3, position: CANNON.Vec3): void => {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(halfExtents), position })
    physicsWorld.addBody(body)
  }

  const chuteHalfWidth = 0.7
  const chuteBackZ = 1.08
  const innerHalfWidth = 2.76
  const innerHalfDepth = 1.92
  const sideFloorHalfWidth = (innerHalfWidth * 2 - chuteHalfWidth * 2) / 4
  const rearFloorHalfDepth = (chuteBackZ + innerHalfDepth) / 2

  // The play floor is split into three colliders, leaving a real opening at the
  // front-center. The four tall boundaries keep loose plushes inside the cabinet.
  addStaticCollider(
    new CANNON.Vec3(sideFloorHalfWidth, 0.1, innerHalfDepth),
    new CANNON.Vec3(-(chuteHalfWidth + sideFloorHalfWidth), 1.72, 0),
  )
  addStaticCollider(
    new CANNON.Vec3(sideFloorHalfWidth, 0.1, innerHalfDepth),
    new CANNON.Vec3(chuteHalfWidth + sideFloorHalfWidth, 1.72, 0),
  )
  addStaticCollider(
    new CANNON.Vec3(chuteHalfWidth, 0.1, rearFloorHalfDepth),
    new CANNON.Vec3(0, 1.72, -innerHalfDepth + rearFloorHalfDepth),
  )
  addStaticCollider(new CANNON.Vec3(0.08, 2.2, 1.94), new CANNON.Vec3(-2.73, 3.65, 0))
  addStaticCollider(new CANNON.Vec3(0.08, 2.2, 1.94), new CANNON.Vec3(2.73, 3.65, 0))
  addStaticCollider(new CANNON.Vec3(2.76, 2.2, 0.08), new CANNON.Vec3(0, 3.65, -1.9))
  addStaticCollider(new CANNON.Vec3(sideFloorHalfWidth, 2.2, 0.08), new CANNON.Vec3(-(chuteHalfWidth + sideFloorHalfWidth), 3.65, 1.9))
  addStaticCollider(new CANNON.Vec3(sideFloorHalfWidth, 2.2, 0.08), new CANNON.Vec3(chuteHalfWidth + sideFloorHalfWidth, 3.65, 1.9))

  // A short, enclosed chute funnels won plushes toward the lower prize door.
  addStaticCollider(new CANNON.Vec3(0.07, 0.78, 0.44), new CANNON.Vec3(-chuteHalfWidth, 0.94, 1.49))
  addStaticCollider(new CANNON.Vec3(0.07, 0.78, 0.44), new CANNON.Vec3(chuteHalfWidth, 0.94, 1.49))
  addStaticCollider(new CANNON.Vec3(chuteHalfWidth, 0.78, 0.07), new CANNON.Vec3(0, 0.94, 1.06))

  function addBox(
    parent: THREE.Object3D,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    castShadow = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
    mesh.position.set(...position)
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  // Lower cabinet shell: separate panels create a real hollow center instead of
  // letting the prize visually pass through one solid box.
  addBox(machineRoot, [6.1, 0.24, 4.45], [0, 0.12, 0], pinkMaterial)
  addBox(machineRoot, [6.1, 1.42, 0.24], [0, 0.83, -2.1], pinkMaterial)
  addBox(machineRoot, [0.24, 1.42, 4.0], [-2.93, 0.83, 0], pinkMaterial)
  addBox(machineRoot, [0.24, 1.42, 4.0], [2.93, 0.83, 0], pinkMaterial)
  addBox(machineRoot, [2.18, 1.42, 0.22], [-1.96, 0.83, 2.1], pinkMaterial)
  addBox(machineRoot, [2.18, 1.42, 0.22], [1.96, 0.83, 2.1], pinkMaterial)
  addBox(machineRoot, [1.74, 0.24, 0.22], [0, 1.42, 2.1], pinkMaterial)
  addBox(machineRoot, [1.74, 0.2, 0.22], [0, 0.2, 2.1], pinkMaterial)

  addBox(
    machineRoot,
    [sideFloorHalfWidth * 2, 0.2, innerHalfDepth * 2],
    [-(chuteHalfWidth + sideFloorHalfWidth), 1.72, 0],
    creamMaterial,
  )
  addBox(
    machineRoot,
    [sideFloorHalfWidth * 2, 0.2, innerHalfDepth * 2],
    [chuteHalfWidth + sideFloorHalfWidth, 1.72, 0],
    creamMaterial,
  )
  addBox(
    machineRoot,
    [chuteHalfWidth * 2, 0.2, rearFloorHalfDepth * 2],
    [0, 1.72, -innerHalfDepth + rearFloorHalfDepth],
    creamMaterial,
  )

  const chuteMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3b62, roughness: 0.88, side: THREE.DoubleSide })
  addBox(machineRoot, [chuteHalfWidth * 2, 0.06, 0.86], [0, 0.3, 1.5], chuteMaterial, false)
  addBox(machineRoot, [0.1, 1.45, 0.9], [-chuteHalfWidth, 0.96, 1.5], darkPinkMaterial)
  addBox(machineRoot, [0.1, 1.45, 0.9], [chuteHalfWidth, 0.96, 1.5], darkPinkMaterial)
  addBox(machineRoot, [chuteHalfWidth * 2, 1.45, 0.1], [0, 0.96, 1.06], darkPinkMaterial)

  const chuteRimMaterial = new THREE.MeshPhysicalMaterial({ color: 0x8fd9de, roughness: 0.42, clearcoat: 0.5 })
  addBox(machineRoot, [1.62, 0.12, 0.12], [0, 1.84, chuteBackZ], chuteRimMaterial)
  addBox(machineRoot, [0.12, 0.12, 0.82], [-0.76, 1.84, 1.49], chuteRimMaterial)
  addBox(machineRoot, [0.12, 0.12, 0.82], [0.76, 1.84, 1.49], chuteRimMaterial)
  addBox(machineRoot, [6.12, 0.34, 4.47], [0, 6.37, 0], pinkMaterial)

  const rainbowMaterials = [0xf6a8bc, 0xffd68c, 0xc8eaa4, 0x9fdded, 0xc8b4ee].map(
    (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, clearcoat: 0.35 }),
  )
  rainbowMaterials.forEach((material, index) => {
    addBox(machineRoot, [1.12, 0.09, 0.12], [-2.24 + index * 1.12, 6.56, 2.18], material)
    addBox(machineRoot, [1.12, 0.06, 0.11], [-2.24 + index * 1.12, 1.68, 2.2], material)
  })

  const cornerPositions: [number, number, number][] = [
    [-2.88, 4.05, -2.03], [2.88, 4.05, -2.03], [-2.88, 4.05, 2.03], [2.88, 4.05, 2.03],
  ]
  cornerPositions.forEach((position) => addBox(machineRoot, [0.18, 4.55, 0.18], position, darkPinkMaterial))

  addBox(machineRoot, [5.62, 4.35, 0.05], [0, 4.05, -2.0], glassMaterial, false)
  addBox(machineRoot, [0.05, 4.35, 3.85], [-2.84, 4.05, 0], glassMaterial, false)
  addBox(machineRoot, [0.05, 4.35, 3.85], [2.84, 4.05, 0], glassMaterial, false)
  addBox(machineRoot, [5.62, 4.35, 0.035], [0, 4.05, 2.0], glassMaterial, false)

  addBox(machineRoot, [2.0, 0.92, 0.16], [0, 0.76, 2.24], darkPinkMaterial)
  addBox(machineRoot, [1.42, 0.55, 0.08], [0, 0.73, 2.34], darkMaterial, false)
  addBox(machineRoot, [1.12, 0.11, 0.72], [0, 0.46, 1.98], darkMaterial, false)

  const chromeRing = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.055, 12, 48), metalMaterial)
  chromeRing.position.set(1.92, 0.92, 2.29)
  chromeRing.rotation.x = Math.PI / 2
  machineRoot.add(chromeRing)
  const startButton = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.3, 0.16, 32),
    new THREE.MeshPhysicalMaterial({ color: 0xffd35f, roughness: 0.34, clearcoat: 0.8 }),
  )
  startButton.position.set(1.92, 0.94, 2.33)
  startButton.rotation.x = Math.PI / 2
  machineRoot.add(startButton)

  const coinSlot = addBox(machineRoot, [0.36, 0.72, 0.12], [-2.05, 0.96, 2.28], darkPinkMaterial)
  addBox(coinSlot, [0.07, 0.35, 0.04], [0, 0.08, 0.09], metalMaterial, false)

  const floorPlane = new THREE.Mesh(
    new THREE.CircleGeometry(7.8, 64),
    new THREE.MeshStandardMaterial({ color: 0xf3abb6, roughness: 0.95 }),
  )
  floorPlane.rotation.x = -Math.PI / 2
  floorPlane.position.y = -0.03
  floorPlane.receiveShadow = true
  scene.add(floorPlane)

  function plushMaterial(color: number): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.94,
      sheen: 1,
      sheenColor: new THREE.Color(color).offsetHSL(0, -0.1, 0.22),
      clearcoat: 0.03,
    })
  }

  function createPlush(kind: number, color: number, name: string): PlushPrize {
    const group = new THREE.Group()
    const main = plushMaterial(color)
    const accent = plushMaterial(new THREE.Color(color).offsetHSL(0.02, 0.04, 0.16).getHex())
    const face = new THREE.MeshStandardMaterial({ color: 0x2e2435, roughness: 0.6 })
    const blush = new THREE.MeshStandardMaterial({ color: 0xee8796, roughness: 0.75 })
    const seam = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).offsetHSL(0, -0.04, -0.12),
      roughness: 1,
    })
    const pose = kind % 6

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 18), main)
    body.scale.set(0.9, 1.08, 0.78)
    body.position.y = -0.12
    body.castShadow = true
    group.add(body)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.58, 28, 22), main)
    head.scale.set(1, 0.94, 0.88)
    head.position.y = 0.48
    head.castShadow = true
    group.add(head)

    const neckSeam = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.012, 7, 34), seam)
    neckSeam.position.set(0, 0.19, 0.015)
    neckSeam.rotation.x = Math.PI / 2
    neckSeam.scale.z = 0.82
    group.add(neckSeam)

    if (kind % 3 === 0) {
      ;[-0.37, 0.37].forEach((x) => {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), accent)
        ear.position.set(x, 0.88, -0.01)
        ear.scale.set(1, 1.08, 0.84)
        ear.castShadow = true
        group.add(ear)
      })
    } else if (kind % 3 === 1) {
      ;[-0.25, 0.25].forEach((x) => {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 14), accent)
        ear.scale.set(0.72, 1.72, 0.66)
        ear.position.set(x, 1.02, -0.025)
        ear.rotation.z = x < 0 ? -0.08 - (pose === 1 ? 0.12 : 0) : 0.08 + (pose === 1 ? 0.12 : 0)
        ear.castShadow = true
        group.add(ear)
      })
    } else {
      ;[-0.37, 0.37].forEach((x) => {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 18), accent)
        ear.position.set(x, 0.92, -0.015)
        ear.rotation.z = x < 0 ? 0.18 : -0.18
        ear.castShadow = true
        group.add(ear)
      })
    }

    ;[-0.2, 0.2].forEach((x) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.073, 16, 12), face)
      eye.scale.set(0.92, 1.18, 0.48)
      eye.position.set(x, 0.56, 0.445)
      group.add(eye)

      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), creamMaterial)
      shine.position.set(x - 0.018, 0.585, 0.478)
      group.add(shine)

      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), blush)
      cheek.scale.set(1.45, 0.58, 0.28)
      cheek.position.set(x * 1.52, 0.39, 0.423)
      group.add(cheek)
    })

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), face)
    nose.scale.z = 0.72
    nose.position.set(0, 0.44, 0.497)
    group.add(nose)

    ;[-1, 1].forEach((side) => {
      const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 7), face)
      mouth.scale.set(1.05, 0.36, 0.42)
      mouth.position.set(side * 0.025, 0.395, 0.496)
      mouth.rotation.z = side * -0.32
      group.add(mouth)
    })

    ;[-0.46, 0.46].forEach((x) => {
      const arm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), main)
      arm.scale.set(0.62, 1.25, 0.65)
      arm.position.set(Math.sign(x) * 0.4, -0.06, 0)
      const wave = pose === 2 ? (x < 0 ? 0.72 : 0.16) : pose === 4 ? (x < 0 ? -0.12 : -0.72) : 0
      arm.rotation.z = (x < 0 ? -0.3 : 0.3) + wave
      arm.castShadow = true
      group.add(arm)
    })

    ;[-0.2, 0.2].forEach((x) => {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), accent)
      foot.scale.set(0.82, 0.62, 1.1)
      foot.position.set(x, -0.54, 0.11)
      foot.rotation.z = pose === 3 ? Math.sign(x) * 0.28 : pose === 5 ? Math.sign(x) * -0.18 : 0
      foot.castShadow = true
      group.add(foot)
    })

    const visualScale = 0.56 + Math.random() * 0.08
    group.scale.setScalar(visualScale)

    const collisionScale = visualScale / 0.6
    const bodyPhysicsMaterial = new CANNON.Material({ friction: 0.76, restitution: 0.02 })
    const physicsBody = new CANNON.Body({
      mass: 0.72,
      material: bodyPhysicsMaterial,
      linearDamping: 0.38,
      angularDamping: 0.58,
      allowSleep: true,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 0.7,
    })
    physicsBody.addShape(new CANNON.Sphere(0.27 * collisionScale), new CANNON.Vec3(0, -0.08 * collisionScale, 0))
    physicsBody.addShape(new CANNON.Sphere(0.34 * collisionScale), new CANNON.Vec3(0, 0.38 * collisionScale, 0))
    physicsBody.addShape(new CANNON.Sphere(0.15 * collisionScale), new CANNON.Vec3(0, -0.43 * collisionScale, 0.03))

    return { group, body: physicsBody, captured: false, unstable: false, name, color, kind }
  }

  const plushColors = [0xf8eadb, 0xf4c66f, 0x8cccd2, 0xd99bb5, 0xb7a1da, 0xa7cf8e, 0xf29f7d]
  const plushNames = ['몽글 곰', '노랑 토끼', '구름 고양이', '분홍 여우', '보라 친구', '초록 다람쥐']
  const prizes: PlushPrize[] = []
  const columns = 8
  const plushCount = 40
  const plushesPerLayer = 24

  for (let index = 0; index < plushCount; index += 1) {
    const prize = createPlush(index, plushColors[index % plushColors.length], plushNames[index % plushNames.length])
    const layer = Math.floor(index / plushesPerLayer)
    const layerIndex = index % plushesPerLayer
    const row = Math.floor(layerIndex / columns)
    const column = layerIndex % columns
    const x = -2.13 + column * 0.61 + layer * 0.12 + (Math.random() - 0.5) * 0.08
    const y = 2.45 + layer * 0.84 + Math.random() * 0.16
    // Keep the front-center chute clear while the pile settles under gravity.
    const z = -1.34 + row * 0.67 + layer * 0.08 + (Math.random() - 0.5) * 0.06
    const restingPoses: [number, number, number][] = [
      [0.08, Math.random() * Math.PI * 2, 0.12],
      [Math.PI * 0.47, Math.random() * Math.PI * 2, 0.2],
      [-Math.PI * 0.48, Math.random() * Math.PI * 2, -0.24],
      [0.42, Math.random() * Math.PI * 2, Math.PI * 0.46],
      [-0.36, Math.random() * Math.PI * 2, -Math.PI * 0.44],
      [Math.PI * 0.86, Math.random() * Math.PI * 2, 0.35],
    ]
    const selectedPose = restingPoses[index % restingPoses.length]
    const rotation = new THREE.Euler(
      selectedPose[0] + (Math.random() - 0.5) * 0.28,
      selectedPose[1],
      selectedPose[2] + (Math.random() - 0.5) * 0.28,
    )
    const quaternion = new THREE.Quaternion().setFromEuler(rotation)

    prize.body.position.set(x, y, z)
    prize.body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
    prize.body.angularVelocity.set((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35)
    physicsWorld.addBody(prize.body)
    prize.group.position.set(x, y, z)
    prize.group.quaternion.copy(quaternion)
    machineRoot.add(prize.group)
    prizes.push(prize)
  }

  const railX = addBox(machineRoot, [5.2, 0.12, 0.16], [0, 5.98, 0], metalMaterial)
  railX.castShadow = true
  addBox(machineRoot, [0.15, 0.1, 3.35], [0, 5.88, 0], metalMaterial)

  const carriage = new THREE.Group()
  machineRoot.add(carriage)
  const carriageBody = addBox(carriage, [0.58, 0.28, 0.58], [0, 5.84, 0], darkPinkMaterial)
  carriageBody.castShadow = true

  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 12), darkMaterial)
  cable.castShadow = true
  machineRoot.add(cable)

  const clawHead = new THREE.Group()
  machineRoot.add(clawHead)
  const headShell = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 18), metalMaterial)
  headShell.scale.y = 0.78
  headShell.castShadow = true
  clawHead.add(headShell)
  const headBand = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.045, 10, 28), darkPinkMaterial)
  headBand.rotation.x = Math.PI / 2
  clawHead.add(headBand)

  const clawArms: THREE.Group[] = []
  for (let index = 0; index < 3; index += 1) {
    const radial = new THREE.Group()
    radial.rotation.y = (index / 3) * Math.PI * 2
    clawHead.add(radial)

    const hinge = new THREE.Group()
    hinge.position.set(0, -0.07, 0.12)
    radial.add(hinge)

    const pivot = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), darkPinkMaterial)
    pivot.castShadow = true
    hinge.add(pivot)

    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.057, 0.61, 6, 12), metalMaterial)
    upperArm.position.set(0, -0.36, 0.29)
    upperArm.rotation.x = -0.5
    upperArm.castShadow = true
    hinge.add(upperArm)

    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.068, 16, 12), metalMaterial)
    elbow.position.set(0, -0.7, 0.51)
    elbow.castShadow = true
    hinge.add(elbow)

    const curvedTip = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.27, 6, 12), metalMaterial)
    curvedTip.position.set(0, -0.86, 0.445)
    curvedTip.rotation.x = 0.5
    curvedTip.castShadow = true
    hinge.add(curvedTip)

    const softTip = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 12), darkPinkMaterial)
    softTip.scale.set(0.86, 1.16, 0.86)
    softTip.position.set(0, -1.04, 0.36)
    softTip.castShadow = true
    hinge.add(softTip)
    clawArms.push(hinge)
  }

  const viewerRenderer = new THREE.WebGLRenderer({ canvas: prizeViewerCanvas, antialias: true, alpha: true })
  viewerRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  viewerRenderer.outputColorSpace = THREE.SRGBColorSpace
  viewerRenderer.toneMapping = THREE.ACESFilmicToneMapping
  viewerRenderer.toneMappingExposure = 1.1
  const viewerScene = new THREE.Scene()
  const viewerCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
  viewerCamera.position.set(0, 0.42, 4.2)
  viewerCamera.lookAt(0, 0.25, 0)
  viewerScene.add(new THREE.HemisphereLight(0xffffff, 0xb7a4dc, 2.4))
  const viewerLight = new THREE.DirectionalLight(0xfff3dc, 3.2)
  viewerLight.position.set(-2.5, 4, 4)
  viewerScene.add(viewerLight)

  const collectedPrizes: PlushPrize[] = []
  let viewerObject: THREE.Group | null = null
  let drawerOpen = false

  function fitObjectToDisplay(object: THREE.Group, targetHeight: number, target: THREE.Vector3): void {
    object.position.set(0, 0, 0)
    object.rotation.set(0, 0, 0)
    object.updateMatrixWorld(true)
    const initialBox = new THREE.Box3().setFromObject(object)
    const size = initialBox.getSize(new THREE.Vector3())
    if (size.y > 0) object.scale.multiplyScalar(targetHeight / size.y)
    object.updateMatrixWorld(true)
    const fittedBox = new THREE.Box3().setFromObject(object)
    const center = fittedBox.getCenter(new THREE.Vector3())
    object.position.copy(target).sub(center)
  }

  function selectCollectedPrize(prize: PlushPrize, selectedButton?: HTMLButtonElement): void {
    if (viewerObject) viewerScene.remove(viewerObject)
    const clone = prize.group.clone(true)
    clone.visible = true
    fitObjectToDisplay(clone, 2.05, new THREE.Vector3(0, 0, 0))
    const holder = new THREE.Group()
    holder.position.y = 0.2
    holder.add(clone)
    viewerScene.add(holder)
    viewerObject = holder
    selectedPrizeName.textContent = prize.name

    prizeListElement.querySelectorAll('.prize-list-item').forEach((item) => item.classList.remove('selected'))
    selectedButton?.classList.add('selected')
  }

  function renderPrizeList(): void {
    prizeCountElement.textContent = String(collectedPrizes.length)
    prizeListElement.innerHTML = ''

    if (collectedPrizes.length === 0) {
      prizeListElement.innerHTML = '<p class="empty-prizes">아직 뽑은 인형이 없어요.<br>첫 번째 인형을 뽑아보세요!</p>'
      return
    }

    collectedPrizes.forEach((prize, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'prize-list-item'
      button.innerHTML = `
        <span class="prize-color" style="--prize-color:#${prize.color.toString(16).padStart(6, '0')}"></span>
        <span><b>${String(index + 1).padStart(2, '0')}</b>${prize.name}</span>
      `
      button.addEventListener('click', () => selectCollectedPrize(prize, button))
      prizeListElement.append(button)
      if (index === collectedPrizes.length - 1) selectCollectedPrize(prize, button)
    })
  }

  function setDrawer(open: boolean): void {
    drawerOpen = open
    prizeDrawer.hidden = !open
    prizesButton.setAttribute('aria-expanded', String(open))
    heldKeys.clear()
    keyIndicators.forEach((indicator) => indicator.classList.remove('pressed'))
    if (open) {
      renderPrizeList()
      closePrizeDrawerButton.focus()
    }
  }

  prizesButton.addEventListener('click', () => setDrawer(true))
  closePrizeDrawerButton.addEventListener('click', () => setDrawer(false))

  let state: ClawState = 'idle'
  let phase = 0
  let clawX = 0
  let clawY = 5.28
  let clawZ = 0
  let capturedPrize: PlushPrize | null = null
  let deliveredPrize: PlushPrize | null = null
  let unstableDropAt = 1
  let celebrationObject: THREE.Group | null = null
  let celebrationStartedAt = 0
  let celebrationBaseY = 3.65
  const heldKeys = new Set<string>()
  const TOP_Y = 5.28
  const PICK_Y = 3.28
  const CHUTE_X = 0
  const CHUTE_Z = 1.5

  function setClawOpen(open: number): void {
    // Each finger swings only on its own radial plane. At the closed angle the
    // three padded tips meet around the prize without crossing one another.
    const angle = THREE.MathUtils.lerp(0.26, -0.34, clamp(open, 0, 1))
    clawArms.forEach((arm) => { arm.rotation.x = angle })
  }

  function syncClaw(): void {
    carriage.position.x = clawX
    carriage.position.z = clawZ
    clawHead.position.set(clawX, clawY, clawZ)
    const cableLength = Math.max(0.12, 5.72 - clawY)
    cable.scale.y = cableLength
    cable.position.set(clawX, clawY + cableLength / 2, clawZ)

    if (capturedPrize) {
      capturedPrize.group.position.set(clawX, clawY - 1.05, clawZ)
      capturedPrize.group.rotation.x *= 0.92
      capturedPrize.group.rotation.z *= 0.92
      capturedPrize.group.rotation.y += 0.015
    }
  }

  function setState(next: ClawState, label: string): void {
    state = next
    phase = 0
    statusElement.textContent = label
  }

  function findPrize(): PlushPrize | null {
    let nearest: PlushPrize | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    prizes.forEach((prize) => {
      if (prize.captured || !prize.group.visible) return
      const distance = Math.hypot(prize.group.position.x - clawX, prize.group.position.z - clawZ)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = prize
      }
    })

    if (!nearest || nearestDistance > 0.94) return null
    const chance = nearestDistance < 0.34 ? 0.9 : nearestDistance < 0.62 ? 0.68 : 0.42
    return Math.random() < chance ? nearest : null
  }

  function attemptGrab(): void {
    const prize = findPrize()
    if (!prize) return
    prize.captured = true
    prize.unstable = Math.random() < 0.38
    unstableDropAt = 0.32 + Math.random() * 0.46
    physicsWorld.removeBody(prize.body)
    capturedPrize = prize
  }

  function dropUnstablePrize(): void {
    if (!capturedPrize) return
    const prize = capturedPrize
    prize.captured = false
    prize.unstable = false
    prize.body.position.set(prize.group.position.x, prize.group.position.y, prize.group.position.z)
    prize.body.quaternion.set(prize.group.quaternion.x, prize.group.quaternion.y, prize.group.quaternion.z, prize.group.quaternion.w)
    prize.body.velocity.set(0, -0.35, 0)
    prize.body.angularVelocity.set((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2)
    physicsWorld.addBody(prize.body)
    capturedPrize = null
    statusElement.textContent = 'OH! IT SLIPPED'
  }

  function celebratePrize(prize: PlushPrize): void {
    prize.group.visible = false
    if (!collectedPrizes.includes(prize)) collectedPrizes.push(prize)
    prizeCountElement.textContent = String(collectedPrizes.length)
    const clone = prize.group.clone(true)
    clone.visible = true
    fitObjectToDisplay(clone, 1.9, new THREE.Vector3(0, 0, 0))
    const holder = new THREE.Group()
    holder.position.set(0, 3.65, 4.75)
    holder.add(clone)
    scene.add(holder)
    celebrationObject = holder
    celebrationBaseY = holder.position.y
    celebrationStartedAt = performance.now()
    celebrationElement.hidden = false
  }

  function beginCycle(): void {
    if (state !== 'idle') return
    heldKeys.clear()
    setState('lowering', 'CLAW DOWN')
  }

  function updateCycle(delta: number): void {
    phase += delta

    if (state === 'idle') {
      const horizontal = Number(heldKeys.has('ArrowRight')) - Number(heldKeys.has('ArrowLeft'))
      const depth = Number(heldKeys.has('ArrowDown')) - Number(heldKeys.has('ArrowUp'))
      clawX = clamp(clawX + horizontal * delta * 2.35, -2.18, 2.18)
      clawZ = clamp(clawZ + depth * delta * 2.05, -1.35, 1.35)
      statusElement.textContent = horizontal || depth ? 'POSITIONING' : 'MOVE THE CLAW'
      return
    }

    if (state === 'lowering') {
      clawY = moveTowards(clawY, PICK_Y, delta * 2.35)
      if (clawY === PICK_Y) setState('closing', 'GRABBING...')
    } else if (state === 'closing') {
      setClawOpen(1 - phase / 0.7)
      if (phase >= 0.7) {
        attemptGrab()
        setState('lifting', capturedPrize ? (capturedPrize.unstable ? 'WOBBLY GRAB!' : 'GOOD GRAB!') : 'EMPTY GRAB')
      }
    } else if (state === 'lifting') {
      const liftProgress = (clawY - PICK_Y) / (TOP_Y - PICK_Y)
      clawY = moveTowards(clawY, TOP_Y, delta * 2.05)
      if (capturedPrize?.unstable && liftProgress > unstableDropAt) dropUnstablePrize()
      if (clawY === TOP_Y) setState('toChute', 'MOVING TO PRIZE DOOR')
    } else if (state === 'toChute') {
      clawX = moveTowards(clawX, CHUTE_X, delta * 2.1)
      clawZ = moveTowards(clawZ, CHUTE_Z, delta * 2.1)
      if (clawX === CHUTE_X && clawZ === CHUTE_Z) setState('releasing', 'RELEASING')
    } else if (state === 'releasing') {
      setClawOpen(phase / 0.55)
      if (phase >= 0.34 && capturedPrize) {
        deliveredPrize = capturedPrize
        capturedPrize = null
        setState('dropping', 'PRIZE DROP!')
      } else if (phase >= 0.7 && !capturedPrize) {
        setState('returning', 'RESETTING')
      }
    } else if (state === 'dropping' && deliveredPrize) {
      deliveredPrize.group.position.x = moveTowards(deliveredPrize.group.position.x, 0, delta * 1.8)
      const prizeDoorZ = deliveredPrize.group.position.y > 1.45 ? CHUTE_Z : 2.02
      deliveredPrize.group.position.z = moveTowards(deliveredPrize.group.position.z, prizeDoorZ, delta * 1.65)
      deliveredPrize.group.position.y -= delta * 4.2
      deliveredPrize.group.rotation.y += delta * 3
      if (deliveredPrize.group.position.y <= 0.72) {
        celebratePrize(deliveredPrize)
        deliveredPrize = null
        setState('returning', 'PRIZE DELIVERED!')
      }
    } else if (state === 'returning') {
      setClawOpen(1)
      clawX = moveTowards(clawX, 0, delta * 2.2)
      clawZ = moveTowards(clawZ, 0, delta * 2.2)
      if (clawX === 0 && clawZ === 0 && phase > 0.65) setState('idle', 'MOVE THE CLAW')
    }
  }

  function updatePlushPhysics(delta: number): void {
    physicsWorld.step(1 / 60, delta, 5)
    prizes.forEach((prize) => {
      if (prize.captured || !prize.group.visible || !prize.body.world) return
      // Numerical safety guard for rare high-speed tunnelling. Normal motion is
      // still handled by Cannon contacts; this only returns an escaped body to
      // the enclosed playfield.
      const escapedSide = Math.abs(prize.body.position.x) > 2.62
      const escapedDepth = prize.body.position.z < -1.78 || prize.body.position.z > 1.82
      const escapedFloor = prize.body.position.y < 1.18
      if (escapedSide || escapedDepth || escapedFloor) {
        prize.body.position.x = clamp(prize.body.position.x, -2.42, 2.42)
        prize.body.position.y = Math.max(prize.body.position.y, 2.35)
        prize.body.position.z = clamp(prize.body.position.z, -1.58, 1.46)
        prize.body.velocity.scale(0.12, prize.body.velocity)
        prize.body.angularVelocity.scale(0.28, prize.body.angularVelocity)
        prize.body.wakeUp()
      }
      prize.group.position.set(prize.body.position.x, prize.body.position.y, prize.body.position.z)
      prize.group.quaternion.set(prize.body.quaternion.x, prize.body.quaternion.y, prize.body.quaternion.z, prize.body.quaternion.w)
    })
  }

  function updateCelebration(timestamp: number): void {
    if (!celebrationObject) return
    const elapsed = (timestamp - celebrationStartedAt) / 1000
    celebrationObject.position.y = celebrationBaseY + Math.sin(elapsed * 7) * 0.14
    celebrationObject.rotation.y = Math.sin(elapsed * 3.2) * 0.24
    celebrationObject.rotation.z = Math.sin(elapsed * 5.1) * 0.08
    if (elapsed >= 2) {
      scene.remove(celebrationObject)
      celebrationObject = null
      celebrationElement.hidden = true
    }
  }

  setClawOpen(1)
  syncClaw()

  const pressedHandler = (event: KeyboardEvent): void => {
    if (!isActive()) return
    const controlKey = event.code === 'Space' ? 'Space' : event.key
    const indicator = keyIndicators.get(controlKey)
    if (indicator) indicator.classList.add('pressed')

    if (drawerOpen && (event.code === 'Space' || event.key.startsWith('Arrow'))) {
      event.preventDefault()
      return
    }
    if (event.code === 'Space') {
      event.preventDefault()
      if (state === 'idle') beginCycle()
      return
    }
    if (!event.key.startsWith('Arrow')) return
    event.preventDefault()
    if (state === 'idle') heldKeys.add(event.key)
  }

  const releasedHandler = (event: KeyboardEvent): void => {
    const controlKey = event.code === 'Space' ? 'Space' : event.key
    keyIndicators.get(controlKey)?.classList.remove('pressed')
    if (event.key.startsWith('Arrow')) heldKeys.delete(event.key)
  }

  window.addEventListener('keydown', pressedHandler)
  window.addEventListener('keyup', releasedHandler)
  window.addEventListener('blur', () => {
    heldKeys.clear()
    keyIndicators.forEach((indicator) => indicator.classList.remove('pressed'))
  })

  let dragging = false
  let pointerX = 0
  let pointerY = 0

  canvas.addEventListener('pointerdown', (event) => {
    if (!isActive()) return
    dragging = true
    pointerX = event.clientX
    pointerY = event.clientY
    canvas.setPointerCapture(event.pointerId)
  })

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return
    const deltaX = event.clientX - pointerX
    const deltaY = event.clientY - pointerY
    pointerX = event.clientX
    pointerY = event.clientY
    machineRoot.rotation.y += deltaX * 0.007
    machineRoot.rotation.x = clamp(machineRoot.rotation.x + deltaY * 0.0025, -0.13, 0.16)
  })

  const endDrag = (event: PointerEvent): void => {
    dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)

  function resize(): void {
    const rect = stage.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    const width = Math.floor(rect.width)
    const height = Math.floor(rect.height)
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
  }

  function renderPrizeViewer(delta: number): void {
    if (!drawerOpen) return
    const rect = prizeViewerCanvas.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    const width = Math.floor(rect.width)
    const height = Math.floor(rect.height)
    viewerRenderer.setSize(width, height, false)
    viewerCamera.aspect = width / height
    viewerCamera.updateProjectionMatrix()
    if (viewerObject) viewerObject.rotation.y += delta * 0.75
    viewerRenderer.render(viewerScene, viewerCamera)
  }

  let previousTime = performance.now()
  function animate(timestamp: number): void {
    requestAnimationFrame(animate)
    if (!isActive() || document.hidden) {
      previousTime = timestamp
      return
    }

    resize()
    const delta = Math.min((timestamp - previousTime) / 1000, 0.04)
    previousTime = timestamp
    updatePlushPhysics(delta)
    updateCycle(delta)
    updateCelebration(timestamp)
    renderPrizeViewer(delta)
    syncClaw()
    renderer.render(scene, camera)
  }

  requestAnimationFrame(animate)
  return { resize }
}
