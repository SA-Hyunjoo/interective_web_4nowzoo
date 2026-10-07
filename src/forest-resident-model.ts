import * as THREE from 'three'
import type { ResidentSkin, ShapeProfile } from './forest-resident-vision'
import { canvas } from './forest-resident-vision'

export interface ResidentModel { group: THREE.Group; textures: THREE.CanvasTexture[]; animate: (time: number, walking: boolean, held?: boolean) => void; dispose: () => void }
type Point = { x: number; y: number }
type Region = (u: number, v: number) => Point

export function createResidentModel(shape: ShapeProfile, skin: ResidentSkin): ResidentModel {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body)
  let seed = shape.seed
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const textures: THREE.CanvasTexture[] = [], geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = []
  const animated: { group: THREE.Group; phase: number; amplitude: number }[] = []
  const skinPixels = skin.cutout.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, skin.cutout.width, skin.cutout.height)
  const { width, height, data } = skinPixels
  const rectangle = (x: number, y: number, w: number, h: number): Region => (u, v) => ({ x: x + u * w, y: y + v * h })
  const bounds = skin.bounds
  const whole = rectangle(bounds.x, bounds.y, bounds.w, bounds.h)
  const landmarks = skin.landmarks
  const visible = (i: number) => Boolean(landmarks[i] && (landmarks[i]!.visibility ?? 1) > 0.45 && landmarks[i]!.x >= 0 && landmarks[i]!.x <= 1 && landmarks[i]!.y >= 0 && landmarks[i]!.y <= 1)
  let face: Region = rectangle(bounds.x + bounds.w * 0.2, bounds.y, bounds.w * 0.6, bounds.h * 0.3)
  let torso: Region = rectangle(bounds.x + bounds.w * 0.2, bounds.y + bounds.h * 0.3, bounds.w * 0.6, bounds.h * 0.5)
  if ([0, 7, 8].every(visible)) {
    const points = landmarks.slice(0, 11)
    const x0 = Math.min(...points.map(p => p.x)), x1 = Math.max(...points.map(p => p.x))
    const y0 = Math.min(...points.map(p => p.y)), y1 = Math.max(...points.map(p => p.y))
    const w = Math.max((x1 - x0) * 1.3, 0.055), h = Math.max((y1 - y0) * 2.7, w * width / height * 1.18)
    face = rectangle((x0 + x1) / 2 - w / 2, y0 - h * 0.32, w, h)
  }
  if ([11, 12, 23, 24].every(visible)) {
    const left = landmarks[11]!.x < landmarks[12]!.x ? [11, 23] : [12, 24]
    const right = left[0] === 11 ? [12, 24] : [11, 23]
    torso = (u, v) => {
      const a = landmarks[left[0]!]!, b = landmarks[right[0]!]!, c = landmarks[left[1]!]!, d = landmarks[right[1]!]!
      return { x: (a.x * (1 - u) + b.x * u) * (1 - v) + (c.x * (1 - u) + d.x * u) * v, y: (a.y * (1 - u) + b.y * u) * (1 - v) + (c.y * (1 - u) + d.y * u) * v }
    }
  }
  function limb(a: number, b: number, c: number, radius: number): Region {
    if (![a, b, c].every(visible)) return torso
    return (u, v) => {
      const start = landmarks[v < 0.5 ? a : b]!, end = landmarks[v < 0.5 ? b : c]!, t = v < 0.5 ? v * 2 : (v - 0.5) * 2
      const dx = (end.x - start.x) * width, dy = (end.y - start.y) * height, length = Math.hypot(dx, dy) || 1
      return { x: start.x + (end.x - start.x) * t + (-dy / length) * (u - 0.5) * radius, y: start.y + (end.y - start.y) * t + (dx / length) * (u - 0.5) * radius * width / height }
    }
  }
  function patch(region: Region) {
    const tile = canvas(192, 192), context = tile.getContext('2d')!, pixels = context.createImageData(192, 192)
    const filled = new Uint8Array(192 * 192), distance = new Uint16Array(192 * 192), queue = new Int32Array(192 * 192)
    let end = 0, r = 0, g = 0, b = 0
    for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) {
      const p = region((x + 0.5) / 192, (y + 0.5) / 192), px = Math.floor(p.x * width), py = Math.floor(p.y * height), source = (py * width + px) * 4, target = (y * 192 + x) * 4
      if (px < 0 || py < 0 || px >= width || py >= height || data[source + 3]! < 200) continue
      pixels.data.set(data.subarray(source, source + 4), target); filled[y * 192 + x] = 1; queue[end++] = y * 192 + x
      r += data[source]!; g += data[source + 1]!; b += data[source + 2]!
    }
    const average = end ? `rgb(${Math.round(r / end)},${Math.round(g / end)},${Math.round(b / end)})` : skin.color
    // Extend only valid HumanSeg pixels into atlas gaps; never sample the background.
    let cursor = 0
    while (cursor < end) {
      const i = queue[cursor++]!, x = i % 192, y = Math.floor(i / 192)
      for (const next of [x > 0 ? i - 1 : -1, x < 191 ? i + 1 : -1, y > 0 ? i - 192 : -1, y < 191 ? i + 192 : -1]) {
        if (next < 0 || filled[next]) continue
        filled[next] = 1; distance[next] = distance[i]! + 1; pixels.data.set(pixels.data.subarray(i * 4, i * 4 + 4), next * 4); queue[end++] = next
      }
    }
    if (!end) { context.fillStyle = average; context.fillRect(0, 0, 192, 192) } else {
      const mean = new THREE.Color(average).convertLinearToSRGB()
      for (let i = 0; i < distance.length; i++) {
        const blend = THREE.MathUtils.smoothstep(distance[i]!, 3, 22)
        for (let channel = 0; channel < 3; channel++) pixels.data[i * 4 + channel] = Math.round(THREE.MathUtils.lerp(pixels.data[i * 4 + channel]!, [mean.r, mean.g, mean.b][channel]! * 255, blend))
      }
      context.putImageData(pixels, 0, 0)
    }
    const edited = skin.textureEdits?.[textures.length]
    if (edited) { context.clearRect(0, 0, tile.width, tile.height); context.drawImage(edited, 0, 0) }
    const texture = new THREE.CanvasTexture(tile); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; textures.push(texture)
    const front = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.86 })
    const back = new THREE.MeshStandardMaterial({ color: average, roughness: 0.88 })
    materials.push(front, back); return [front, back]
  }
  const faceMaterial = patch(face), bodyMaterial = patch(torso), wholeMaterial = patch(whole)
  // From a front view, anatomical right is the model's negative X side.
  const limbMaterials = [patch(limb(12, 14, 16, bounds.w * 0.25)), patch(limb(11, 13, 15, bounds.w * 0.25)), patch(limb(24, 26, 28, bounds.w * 0.3)), patch(limb(23, 25, 27, bounds.w * 0.3))]
  const unitSphere = new THREE.SphereGeometry(1, 32, 24)
  function project(geometry: THREE.BufferGeometry) {
    const positions = geometry.attributes.position, uv = geometry.attributes.uv
    geometry.computeBoundingBox(); const box = geometry.boundingBox!, size = box.getSize(new THREE.Vector3())
    for (let i = 0; i < positions.count; i++) uv.setXY(i, (positions.getX(i) - box.min.x) / (size.x || 1), (positions.getY(i) - box.min.y) / (size.y || 1))
    const front: number[] = [], back: number[] = [], index = geometry.index
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const ids = [0, 1, 2].map(offset => index ? index.getX(i + offset) : i + offset)
      const z = ids.reduce((sum, id) => sum + positions.getZ(id), 0) / 3
      ;(z >= 0.08 * size.z ? front : back).push(...ids)
    }
    geometry.setIndex([...front, ...back]); geometry.clearGroups(); geometry.addGroup(0, front.length, 0); geometry.addGroup(front.length, back.length, 1)
    geometries.push(geometry); return geometry
  }
  const ball = project(unitSphere)
  const solid = (color: string) => { const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8 }); materials.push(material); return material }
  const detail = solid('#3b3430'), highlight = solid('#fff7e3'), blush = solid('#dca59b')
  const referenceAccent = new THREE.Color(shape.color).lerp(new THREE.Color(skin.color), 0.7)
  const accent = solid(`#${referenceAccent.getHexString()}`)
  const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const item = new THREE.Mesh(geometry, material); item.position.set(x, y, z); item.scale.set(sx, sy, sz); item.castShadow = true; item.receiveShadow = true; parent.add(item); return item
  }
  const widthScale = THREE.MathUtils.clamp(shape.aspect * 0.3 + 0.8, 0.8, 1.25)
  const headWidth = 0.36 * widthScale * (0.95 + random() * 0.12)
  const belly = 0.22 + shape.fullness * 0.075
  const hasFace = [0, 2, 5].every(visible)
  function facialPoint(index: number) {
    const a = face(0, 0), b = face(1, 1), point = landmarks[index]!
    const x = THREE.MathUtils.clamp((point.x - a.x) / (b.x - a.x) * 2 - 1, -0.8, 0.8)
    const y = THREE.MathUtils.clamp(1 - (point.y - a.y) / (b.y - a.y) * 2, -0.8, 0.8)
    return { x: x * headWidth, y: y * 0.31, z: Math.sqrt(Math.max(0.1, 1 - x * x - y * y)) * 0.285 + 0.016 }
  }
  if (shape.kind === 'object') {
    const outline = new THREE.Shape(), rows = shape.rows
    const w = THREE.MathUtils.clamp(shape.aspect, 0.6, 1.7) * 0.85
    rows.forEach((row, i) => { const x = (row.left - 0.5) * w, y = (1 - row.y) * 1.05 + 0.08; if (i === 0) outline.moveTo(x, y); else outline.lineTo(x, y) })
    ;[...rows].reverse().forEach(row => outline.lineTo((row.right - 0.5) * w, (1 - row.y) * 1.05 + 0.08)); outline.closePath()
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: 0.3, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: 0.055, bevelThickness: 0.085, curveSegments: 16 })
    geometry.translate(0, 0, -0.15); project(geometry); mesh(body, geometry, wholeMaterial, 0, 0, 0, 1, 1, 1)
  } else {
    mesh(body, ball, bodyMaterial, 0, 0.49, 0, belly, 0.31, 0.22)
    const head = new THREE.Group(); head.position.y = 0.95; body.add(head)
    mesh(head, ball, faceMaterial, 0, 0, 0, headWidth, 0.31, 0.285)
    // Short limbs, large heads and rounded details keep every type in the same toy scale.
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1
      const arm = new THREE.Group(); arm.position.set(sign * belly, 0.63, 0); body.add(arm)
      const armMesh = mesh(arm, ball, limbMaterials[side]!, sign * 0.07, -0.11, 0, shape.kind === 'bird' ? 0.12 : 0.075, 0.18, 0.075); armMesh.rotation.z = sign * 0.3
      animated.push({ group: arm, phase: side * Math.PI, amplitude: 0.42 })
      const leg = new THREE.Group(); leg.position.set(sign * 0.115, 0.23, 0); body.add(leg)
      mesh(leg, ball, limbMaterials[side + 2]!, 0, -0.09, 0.025, 0.085, 0.15, 0.10); animated.push({ group: leg, phase: (1 - side) * Math.PI, amplitude: 0.55 })
      if (['cat', 'rabbit', 'dog', 'bear', 'deer', 'pig', 'human', 'elephant'].includes(shape.kind)) {
        const long = shape.kind === 'rabbit', floppy = shape.kind === 'dog', elephant = shape.kind === 'elephant'
        if (shape.kind === 'cat' || shape.kind === 'deer') {
          const earGeometry = project(new THREE.ConeGeometry(1, 2, 24)); const ear = mesh(head, earGeometry, faceMaterial[1]!, sign * headWidth * 0.68, 0.28, -0.01, 0.115, 0.15, 0.09); ear.rotation.z = -sign * 0.22
        } else {
          const isHuman = shape.kind === 'human'
          const ear = mesh(head, ball, faceMaterial[1]!, sign * headWidth * (floppy || elephant || isHuman ? 1 : 0.78), long ? 0.38 : floppy || isHuman ? 0.02 : 0.2, -0.025, elephant ? 0.22 : isHuman ? 0.065 : 0.095, long ? 0.27 : floppy ? 0.23 : elephant ? 0.26 : 0.105, 0.065); ear.rotation.z = sign * (long ? -0.16 : floppy ? 0.18 : 0)
          if (shape.kind !== 'human') mesh(head, ball, blush, sign * headWidth * 0.78, long ? 0.39 : 0.22, 0.036, 0.055, long ? 0.19 : 0.055, 0.012)
        }
      }
      if (shape.kind === 'frog') {
        mesh(head, ball, faceMaterial, sign * 0.24, 0.23, 0.03, 0.13, 0.15, 0.12)
        mesh(head, ball, highlight, sign * 0.24, 0.27, 0.13, 0.065, 0.077, 0.032)
        mesh(head, ball, detail, sign * 0.24, 0.27, 0.156, 0.029, 0.045, 0.015)
      } else if (shape.kind !== 'human') {
        const leftEye = hasFace && landmarks[2]!.x < landmarks[5]!.x ? 2 : 5
        const eye = hasFace ? facialPoint(side === 0 ? leftEye : leftEye === 2 ? 5 : 2) : { x: sign * headWidth * 0.42, y: 0.04, z: 0.267 }
        mesh(head, ball, detail, eye.x, eye.y, eye.z, 0.037, 0.046, 0.019)
        mesh(head, ball, highlight, eye.x - 0.009, eye.y + 0.015, eye.z + 0.017, 0.010, 0.013, 0.007)
      }
    }
    if (shape.kind === 'bird') mesh(head, ball, accent, 0, -0.075, 0.31, 0.135, 0.065, 0.14)
    if (['dog', 'bear', 'pig', 'deer'].includes(shape.kind)) {
      mesh(head, ball, faceMaterial[1]!, 0, -0.10, 0.245, shape.kind === 'pig' ? 0.15 : 0.135, 0.092, 0.12)
      if (shape.kind === 'pig') for (const x of [-0.04, 0.04]) mesh(head, ball, detail, x, -0.10, 0.362, 0.017, 0.024, 0.008)
      else mesh(head, ball, detail, 0, -0.06, 0.365, 0.044, 0.03, 0.022)
    }
    if (shape.kind === 'cat' || shape.kind === 'rabbit') {
      const nose = hasFace ? facialPoint(0) : { x: 0, y: -0.055, z: 0.287 }
      mesh(head, ball, blush, nose.x, nose.y, nose.z, 0.032, 0.024, 0.017)
    }
    if (shape.kind === 'elephant') {
      const trunk = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.07, 0.25), new THREE.Vector3(0, -0.26, 0.38), new THREE.Vector3(0.05, -0.37, 0.44)])
      const geometry = project(new THREE.TubeGeometry(trunk, 16, 0.065, 12, false)); mesh(head, geometry, faceMaterial[1]!, 0, 0, 0, 1, 1, 1)
    }
    if (shape.kind === 'deer') for (const sign of [-1, 1]) {
      const horn = project(new THREE.CylinderGeometry(0.016, 0.032, 0.25, 8)); mesh(head, horn, wholeMaterial, sign * 0.19, 0.39, -0.03, 1, 1, 1)
      const branch = mesh(head, ball, wholeMaterial, sign * 0.23, 0.43, -0.03, 0.02, 0.08, 0.025); branch.rotation.z = -sign * 0.8
    }
    if (['cat', 'dog', 'rabbit', 'bear'].includes(shape.kind)) {
      const geometry = project(new THREE.TorusGeometry(0.18, 0.055, 10, 20, Math.PI * 1.5))
      mesh(body, geometry, bodyMaterial, 0.05, 0.43, -0.23, 1, 1, 1)
    }
    if (shape.kind === 'octopus') for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, tentacle = new THREE.Group(); tentacle.position.set(Math.sin(a) * 0.17, 0.26, Math.cos(a) * 0.16); body.add(tentacle)
      mesh(tentacle, ball, bodyMaterial, Math.sin(a) * 0.08, -0.08, Math.cos(a) * 0.08, 0.085, 0.17, 0.085); animated.push({ group: tentacle, phase: a, amplitude: 0.24 })
    }
  }
  return { group, textures,
    animate(time, walking, held = false) { body.rotation.z = held ? Math.sin(time * 19) * 0.13 : 0; body.position.y = held ? Math.sin(time * 24) * 0.015 : walking ? Math.abs(Math.sin(time * 7)) * 0.025 : Math.sin(time * 2) * 0.007; for (const item of animated) { item.group.rotation.x = held ? Math.sin(time * 24 + item.phase) * 0.95 : walking ? Math.sin(time * 7 + item.phase) * item.amplitude : Math.sin(time * 1.6 + item.phase) * 0.05 } },
    dispose() { geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose()); group.removeFromParent() },
  }
}
