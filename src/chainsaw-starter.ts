import * as THREE from 'three'

/** Reusable solid starter handle and interlocking metal links, in screen-pixel world units. */
export function createChainsawStarter() {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: 0xff8b24, metalness: .45, roughness: .3 })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, .15, 10, 40), material)
  group.add(ring)
  const links = new THREE.InstancedMesh(
    new THREE.TorusGeometry(4, 1.3, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xb6c6d3, metalness: .8, roughness: .3 }), 48,
  )
  links.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  links.frustumCulled = false
  group.add(links)
  const dummy = new THREE.Object3D(), end = new THREE.Vector3(), direction = new THREE.Vector3()
  const axis = new THREE.Vector3(0, 1, 0), alignment = new THREE.Quaternion(), twist = new THREE.Quaternion()
  const bounds = new THREE.Box3()
  function update(anchor: THREE.Vector3, center: THREE.Vector3, radius: number, rotation: THREE.Quaternion, held: boolean) {
    ring.position.copy(center)
    ring.scale.set(radius, radius*.85, radius)
    // Keep a broad visible opening even during large head turns.
    ring.quaternion.identity().slerp(rotation, held ? .12 : .35)
    material.color.setHex(held ? 0x8effce : 0xff8b24)
    material.emissive.setHex(held ? 0x15452b : 0x321000)
    end.set(0, -radius*.85, 0).applyQuaternion(ring.quaternion).add(center)
    direction.subVectors(end, anchor)
    const distance = direction.length()
    alignment.setFromUnitVectors(axis, direction.normalize())
    links.count = Math.max(2, Math.min(48, Math.ceil(distance/7)))
    for (let i = 0; i < links.count; i++) {
      dummy.position.lerpVectors(anchor, end, (i+.5)/links.count)
      dummy.quaternion.copy(alignment).multiply(twist.setFromAxisAngle(axis, i%2*Math.PI/2))
      dummy.scale.set(1, Math.max(1, distance/links.count/6), 1)
      dummy.updateMatrix(); links.setMatrixAt(i, dummy.matrix)
    }
    links.instanceMatrix.needsUpdate = true
    ring.updateMatrixWorld(true)
    bounds.setFromObject(ring)
    return { x: (bounds.max.x-bounds.min.x)/2, y: (bounds.max.y-bounds.min.y)/2 }
  }
  return { group, ring, links, update }
}

export function starterHit(point: { x: number; y: number }, center: { x: number; y: number }, radius: { x: number; y: number }) {
  return Math.hypot((point.x-center.x)/(radius.x+42), (point.y-center.y)/(radius.y+42)) <= 1
}
