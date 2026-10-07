import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createChainsawStarter, starterHit } from '../src/chainsaw-starter.ts'

test('3D starter retains a large target during head rotation and follows its center', () => {
  const starter = createChainsawStarter()
  const anchor = new THREE.Vector3(0, 100, 20)
  const center = new THREE.Vector3(60, 200, 80)
  for (const yaw of [-1.4, 0, 1.4]) {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, yaw, .3))
    const radius = starter.update(anchor, center, 60, rotation, false)
    assert.ok(radius.x > 45 && radius.y > 40)
    assert.deepEqual(starter.ring.position.toArray(), center.toArray())
    assert.ok(starterHit({ x: 60+radius.x+30, y: 200 }, { x: 60, y: 200 }, radius))
    assert.ok(!starterHit({ x: 60+radius.x+60, y: 200 }, { x: 60, y: 200 }, radius))
  }
})

test('chain remains finite during long pulls without allocating new geometry', () => {
  const starter = createChainsawStarter()
  const geometry = starter.links.geometry
  for (const distance of [0, 30, 120, 1000]) {
    starter.update(new THREE.Vector3(), new THREE.Vector3(40, distance, 50), 60, new THREE.Quaternion(), true)
    assert.ok(starter.links.count >= 2 && starter.links.count <= 48)
    assert.ok(starter.links.instanceMatrix.array.every(Number.isFinite))
    assert.equal(starter.links.geometry, geometry)
  }
})
