import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createChainsawModel } from '../src/chainsaw-model.ts'

test('head blade projects forward and both arms have reusable chains', () => {
  const model = createChainsawModel()
  assert.equal(model.arms.length, 2)
  const bounds = new THREE.Box3().setFromObject(model.head)
  assert.ok(bounds.max.z > 2.5, 'forehead saw must extend forward along Z')
  assert.ok(bounds.max.x < 1, 'forehead saw must not stick sideways in neutral pose')
  for (const arm of model.arms) {
    const bounds = new THREE.Box3().setFromObject(arm)
    assert.ok(bounds.max.y > 2, 'arm blade extends past fingertips')
    assert.ok(bounds.min.y < 0, 'arm blade/case extends back toward forearm')
  }
})

test('chain animation stays finite and reuses geometry/materials', () => {
  const model = createChainsawModel()
  const resources = []
  const chains = []
  for (const root of [model.head, ...model.arms]) root.traverse(object => {
    if (object.isMesh) resources.push([object, object.geometry, object.material])
    if (object.isInstancedMesh && object.count === 72) chains.push(object)
  })
  assert.equal(chains.length, 3)
  model.animate(0)
  const before = chains[0].instanceMatrix.array.slice()
  for (const time of [16, 500, 1234, 100000, 3600000]) {
    model.animate(time)
    for (const chain of chains) assert.ok(chain.instanceMatrix.array.every(Number.isFinite))
  }
  assert.notDeepEqual(chains[0].instanceMatrix.array, before)
  for (const [mesh, geometry, material] of resources) {
    assert.equal(mesh.geometry, geometry)
    assert.equal(mesh.material, material)
  }
})
