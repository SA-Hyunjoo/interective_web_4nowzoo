import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { fitChainsawFace } from '../src/chainsaw-pose.ts'

test('face fit matches housing center, independent width/height and mirrored rotation', () => {
  for (const [width,height] of [[1280,720],[390,844]]) {
    for (const yaw of [-.7,0,.7]) {
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.15,yaw,.2))
      const center = new THREE.Vector3(20,-30,0)
      const cover = Math.max(width/960,height/540), w = cover*960, h = cover*540
      const points = Array.from({ length: 468 }, () => ({ x: .5,y: .5,z: 0 }))
      for (const [index,x,y] of [[10,0,.84],[152,0,-.94],[234,.6,-.05],[454,-.6,-.05]]) {
        const p = new THREE.Vector3(x*160,y*190,.465*160).applyQuaternion(rotation).add(center)
        points[index] = { x: .5-p.x/w,y: .5-p.y/h,z: -p.z/w }
      }
      const fit = fitChainsawFace(points,width,height,960,540)
      assert.ok(Math.abs(fit.x-(width/2+20)) < 1e-6)
      assert.ok(Math.abs(fit.y-(height/2+30)) < 1e-6)
      assert.ok(Math.abs(fit.size-160) < 1e-6)
      assert.ok(Math.abs(fit.height-190) < 1e-6)
      assert.ok(fit.rotation.angleTo(rotation) < 1e-6)
    }
  }
})
