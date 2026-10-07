import * as THREE from 'three'

// All dimensions are face-width units. Geometry/materials are constructed once.
export function createChainsawModel() {
  const ramp = new THREE.DataTexture(new Uint8Array([55, 120, 195, 255]), 4, 1, THREE.RedFormat)
  ramp.needsUpdate = true
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter
  ramp.unpackAlignment = 1
  const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: ramp })
  const orange = toon(0xf07820), dark = toon(0x20272c), black = toon(0x06090c)
  const steel = toon(0xa7bac3), edge = toon(0xe7eee2), rust = toon(0x713520)
  const box = new THREE.BoxGeometry(1, 1, 1)
  const bolt = new THREE.CylinderGeometry(.045, .045, .035, 6)
  const tooth = new THREE.ConeGeometry(1, 1, 3)
  const dummy = new THREE.Object3D()
  function part(parent: THREE.Group, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, geometry: THREE.BufferGeometry = box) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh)
    return mesh
  }
  function extrude(parent: THREE.Group, points: number[][], depth: number, material: THREE.Material, z: number) {
    const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])))
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .035, bevelThickness: .035 })
    return part(parent, material, 0, 0, z, 1, 1, 1, geometry)
  }
  const head = new THREE.Group()
  // A solid dark rear case also hides the webcam face through the open jaw.
  extrude(head, [[-.52,-.62],[.52,-.62],[.6,.48],[.35,.8],[-.35,.8],[-.6,.48]], .48, dark, -.32)
  extrude(head, [[-.6,.02],[.6,.02],[.54,.61],[.27,.84],[-.27,.84],[-.54,.61]], .64, orange, -.22)
  extrude(head, [[-.51,-.48],[.51,-.48],[.28,-.75],[0,-.94],[-.28,-.75]], .48, orange, .03)
  part(head, black, 0, -.27, .25, 1.06, .57, .13)
  // Recessed mechanical cheek plates, side ventilation and hex bolts.
  for (const side of [-1, 1]) {
    part(head, dark, side*.57, .29, -.05, .12, .62, .58)
    for (let i = 0; i < 4; i++) {
      const vent = part(head, black, side*.637, .14+i*.105, .02, .016, .042, .39-i*.025)
      vent.rotation.x = -.18
    }
    for (const y of [.07,.55]) {
      const screw = part(head, steel, side*.655, y, -.16, 1, 1, 1, bolt)
      screw.rotation.z = Math.PI/2
    }
    for (let i = 0; i < 5; i++) part(head, rust, side*(.3+i*.043), -.45, -.02, .025, .51, .075).rotation.z = side*-.18
  }
  // Engine's upper rectangular carry handle, clearly separate from the casing.
  part(head, dark, -.34, .99, -.12, .095, .45, .1)
  part(head, dark, .34, .99, -.12, .095, .45, .1)
  part(head, dark, 0, 1.19, -.12, .77, .1, .1)
  part(head, steel, 0, 1.245, -.12, .6, .012, .06)
  const teeth = new THREE.InstancedMesh(tooth, edge, 52)
  for (let i = 0; i < 26; i++) {
    const x = -.49 + i*.0392
    for (let j = 0; j < 2; j++) {
      const h = .23 + .09 * (.5+.5*Math.sin(i*17.1+j*2.3))
      dummy.position.set(x, j ? -.5+h/2 : -.025-h/2, .39 + .055*Math.cos(x*3))
      dummy.rotation.set(0, 0, j ? .09*Math.sin(i) : Math.PI+.09*Math.sin(i))
      dummy.scale.set(.025, h, .043); dummy.updateMatrix()
      teeth.setMatrixAt(i*2+j, dummy.matrix)
    }
  }
  head.add(teeth)
  const chains: { teeth: THREE.InstancedMesh; length: number; radius: number }[] = []
  function blade(length: number, radius: number) {
    const group = new THREE.Group()
    const shape = new THREE.Shape()
    shape.moveTo(-radius, 0); shape.lineTo(-radius, length)
    shape.absarc(0, length, radius, Math.PI, 0, true)
    shape.lineTo(radius, 0); shape.absarc(0, 0, radius, 0, -Math.PI, true)
    const bar = new THREE.ExtrudeGeometry(shape, { depth: .065, bevelEnabled: false, curveSegments: 10 })
    part(group, dark, 0, 0, -.045, 1.13, 1, 1.4, bar)
    part(group, steel, 0, 0, -.033, 1, 1, 1, bar)
    part(group, edge, -radius*.36, length/2, .035, .035, length*.88, .012)
    part(group, dark, radius*.3, length/2, .035, .015, length*.76, .012)
    const chain = new THREE.InstancedMesh(tooth, edge, 72)
    chain.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    chain.frustumCulled = false
    group.add(chain); chains.push({ teeth: chain, length, radius })
    return group
  }
  const forehead = blade(2.25, .15)
  forehead.position.set(0, .46, .38)
  // Blade plane is vertical, its long axis projects FORWARD, not sideways.
  forehead.rotation.set(Math.PI/2, Math.PI/2, 0)
  head.add(forehead)
  const arms = [new THREE.Group(), new THREE.Group()]
  arms.forEach(arm => {
    part(arm, dark, 0, -.1, 0, .32, .46, .26)
    const saw = blade(2.5, .18); saw.position.y = -.4; arm.add(saw)
    part(arm, orange, 0, -.14, .15, .26, .24, .08)
  })
  function animate(time: number) {
    for (const chain of chains) {
      const { length: l, radius: r, teeth: mesh } = chain
      const total = 2*l+2*Math.PI*r
      for (let i = 0; i < mesh.count; i++) {
        let d = (i/mesh.count*total + time*.006) % total
        let x: number, y: number, nx: number, ny: number
        if (d < l) { x = r; y = d; nx = 1; ny = 0 }
        else if ((d -= l) < Math.PI*r) {
          const a = d/r; nx = Math.cos(a); ny = Math.sin(a); x = r*nx; y = l+r*ny
        } else if ((d -= Math.PI*r) < l) { x = -r; y = l-d; nx = -1; ny = 0 }
        else { const a = Math.PI+(d-l)/r; nx = Math.cos(a); ny = Math.sin(a); x = r*nx; y = r*ny }
        dummy.position.set(x+nx*.025,y+ny*.025,0)
        dummy.rotation.set(0,0,Math.atan2(ny,nx)-Math.PI/2-.25)
        dummy.scale.set(.05,.11,.055); dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
  }
  animate(0)
  return { head, arms, animate }
}
