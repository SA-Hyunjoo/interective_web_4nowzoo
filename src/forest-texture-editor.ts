import * as THREE from 'three'
import type { ResidentModel } from './forest-resident-model'

export function createTextureEditor(area: HTMLElement, surface: HTMLCanvasElement, camera: THREE.Camera, getModel: () => ResidentModel | null, panel: HTMLElement) {
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2()
  let active = false, drag: { id: number; x: number; y: number; uv?: THREE.Vector2; mesh?: THREE.Object3D; texture?: THREE.CanvasTexture; rotate: boolean } | null = null
  const history: { texture: THREE.CanvasTexture; data: ImageData }[] = []
  const mode = panel.querySelector<HTMLSelectElement>('[data-brush-mode]')!, size = panel.querySelector<HTMLInputElement>('[data-brush-size]')!
  const hint = panel.querySelector<HTMLElement>('[data-edit-hint]')!
  const original = new Map<THREE.CanvasTexture, ImageData>()
  function hit(x: number, y: number) {
    const model = getModel(); if (!model) return
    const box = surface.getBoundingClientRect(); pointer.set((x - box.left) / box.width * 2 - 1, -(y - box.top) / box.height * 2 + 1)
    model.group.updateMatrixWorld(true); camera.updateMatrixWorld(); ray.setFromCamera(pointer, camera)
    return ray.intersectObject(model.group, true).find(result => {
      if (!(result.object instanceof THREE.Mesh) || !result.uv) return false
      const material = Array.isArray(result.object.material) ? result.object.material[result.face?.materialIndex ?? 0] : result.object.material
      return material instanceof THREE.MeshStandardMaterial && material.map instanceof THREE.CanvasTexture
    })
  }
  function warp(texture: THREE.CanvasTexture, uv: THREE.Vector2, delta: THREE.Vector2) {
    const canvas = texture.image as HTMLCanvasElement, ctx = canvas.getContext('2d', { willReadFrequently: true })!, width = canvas.width, height = canvas.height
    const source = ctx.getImageData(0, 0, width, height), output = new ImageData(new Uint8ClampedArray(source.data), width, height)
    const cx = uv.x * width, cy = (1 - uv.y) * height, radius = Number(size.value) * width
    const dx = THREE.MathUtils.clamp(delta.x * width, -radius * 0.15, radius * 0.15), dy = THREE.MathUtils.clamp(-delta.y * height, -radius * 0.15, radius * 0.15)
    const amount = Math.min(0.085, Math.hypot(dx, dy) / radius) * (mode.value === 'shrink' ? -1 : 1)
    for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, cy + radius); y++) for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(width, cx + radius); x++) {
      const rx = x - cx, ry = y - cy, d = Math.hypot(rx, ry) / radius; if (d >= 1) continue
      // Compact C2 falloff influences an entire neighborhood, with no sharp brush edge.
      const weight = (1 - d * d) ** 3
      const sx = THREE.MathUtils.clamp(mode.value === 'move' ? x - dx * weight : cx + rx / (1 + amount * weight), 0, width - 1)
      const sy = THREE.MathUtils.clamp(mode.value === 'move' ? y - dy * weight : cy + ry / (1 + amount * weight), 0, height - 1)
      const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0
      for (let c = 0; c < 4; c++) {
        const sample = (px: number, py: number) => source.data[(Math.min(py, height - 1) * width + Math.min(px, width - 1)) * 4 + c]!
        output.data[(y * width + x) * 4 + c] = (sample(x0, y0) * (1 - tx) + sample(x0 + 1, y0) * tx) * (1 - ty) + (sample(x0, y0 + 1) * (1 - tx) + sample(x0 + 1, y0 + 1) * tx) * ty
      }
    }
    ctx.putImageData(output, 0, 0); texture.needsUpdate = true
  }
  function down(event: PointerEvent) {
    if (!active || drag || (event.button !== 0 && event.button !== 2)) return
    const model = getModel(); if (!model) return
    event.preventDefault(); const rotate = event.button === 2 || event.altKey || mode.value === 'rotate'
    if (rotate) drag = { id: event.pointerId, x: event.clientX, y: event.clientY, rotate: true }
    else {
      const point = hit(event.clientX, event.clientY); if (!point?.uv || !(point.object instanceof THREE.Mesh)) { hint.textContent = '사진이 입혀진 표면을 드래그해 주세요.'; return }
      const material = (Array.isArray(point.object.material) ? point.object.material[point.face?.materialIndex ?? 0] : point.object.material) as THREE.MeshStandardMaterial
      const texture = material.map as THREE.CanvasTexture, canvas = texture.image as HTMLCanvasElement
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      if (!original.has(texture)) original.set(texture, data)
      history.push({ texture, data }); if (history.length > 24) history.shift()
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, uv: point.uv.clone(), mesh: point.object, texture, rotate: false }
    }
    area.setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return
    event.preventDefault(); const model = getModel(); if (!model) return
    if (drag.rotate) {
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
      model.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (event.clientX - drag.x) * 0.008))
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
      model.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(right, (event.clientY - drag.y) * 0.006))
    } else {
      const point = hit(event.clientX, event.clientY)
      if (point?.uv && point.object === drag.mesh && drag.uv && drag.texture) {
        const delta = point.uv.clone().sub(drag.uv)
        if (delta.length() < 0.18) warp(drag.texture, drag.uv, delta)
        drag.uv.copy(point.uv); hint.textContent = '주변 텍스처까지 부드럽게 조정하고 있어요.'
      }
    }
    drag.x = event.clientX; drag.y = event.clientY
  }
  function end(event: PointerEvent) { if (drag?.id === event.pointerId) { if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId); drag = null } }
  const context = (event: Event) => event.preventDefault()
  const undo = () => { const last = history.pop(); if (last) { (last.texture.image as HTMLCanvasElement).getContext('2d')!.putImageData(last.data, 0, 0); last.texture.needsUpdate = true } }
  const reset = () => { original.forEach((data, texture) => { (texture.image as HTMLCanvasElement).getContext('2d')!.putImageData(data, 0, 0); texture.needsUpdate = true }); history.length = 0 }
  area.addEventListener('pointerdown', down); area.addEventListener('pointermove', move); area.addEventListener('pointerup', end); area.addEventListener('pointercancel', end); area.addEventListener('contextmenu', context)
  panel.querySelector('[data-edit-undo]')!.addEventListener('click', undo); panel.querySelector('[data-edit-reset]')!.addEventListener('click', reset)
  return {
    setActive(value: boolean) { active = value; drag = null; area.hidden = !value; panel.hidden = !value },
    clear() { drag = null; history.length = 0; original.clear() },
    dispose() { area.removeEventListener('pointerdown', down); area.removeEventListener('pointermove', move); area.removeEventListener('pointerup', end); area.removeEventListener('pointercancel', end); area.removeEventListener('contextmenu', context); history.length = 0; original.clear() },
  }
}
