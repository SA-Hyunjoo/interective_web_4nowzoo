import * as THREE from 'three'

type Landmark = { x: number; y: number; z: number }

/** Match model housing (not its blade/handle) to the forehead, chin and cheeks. */
export function fitChainsawFace(points: Landmark[], width: number, height: number, videoWidth: number, videoHeight: number) {
  const cover = Math.max(width/videoWidth, height/videoHeight)
  const w = videoWidth*cover, h = videoHeight*cover
  const point = (index: number) => new THREE.Vector3((.5-points[index].x)*w, (.5-points[index].y)*h, -points[index].z*w)
  const left = point(454), right = point(234), top = point(10), chin = point(152)
  const x = right.clone().sub(left), y = top.clone().sub(chin)
  const sx = Math.max(30, x.length()/1.2), sy = Math.max(30, y.length()/1.78)
  x.normalize(); y.normalize()
  const z = new THREE.Vector3().crossVectors(x,y).normalize()
  y.crossVectors(z,x).normalize()
  const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z))
  // Register the VISIBLE front surface, not the engine's inner center plane.
  // Housing front z=.42, lower jaw front z=.51: midpoint z=.465.
  // The former z=.1 offset displaced the mask sideways during head turns.
  const offset = new THREE.Vector3(0, -.05*sy, .465*sx).applyQuaternion(rotation)
  const center = top.clone().add(chin).multiplyScalar(.5).sub(offset)
  return { x: center.x+width/2, y: height/2-center.y, size: sx, height: sy, rotation,
    chin: { x: chin.x+width/2, y: height/2-chin.y } }
}
