import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {createChainsawEnemies,distanceToSegment,sweepHitsEnemy} from '../src/chainsaw-enemies.ts'

test('saw collision requires a fast sweep crossing the enemy',()=>{
  const enemy={x:300,y:300,size:70}
  const crossing={start:{x:100,y:310},end:{x:500,y:310},speed:800}
  assert.equal(distanceToSegment({x:300,y:300},crossing.start,crossing.end),10)
  assert.equal(sweepHitsEnemy(crossing,enemy),true)
  assert.equal(sweepHitsEnemy({...crossing,speed:200},enemy),false)
  assert.equal(sweepHitsEnemy({...crossing,start:{x:100,y:40},end:{x:500,y:40}},enemy),false)
})

test('cutting a pooled enemy creates reusable body and blood fragments',()=>{
  const scene=new THREE.Scene(),system=createChainsawEnemies(scene)
  system.setActive(true,0);system.update(400,0,1280,720,[],()=>{})
  const enemy=system.enemies.find(value=>value.active)
  assert.ok(enemy)
  let cuts=0
  system.update(401,0,1280,720,[{start:{x:enemy.x-150,y:enemy.y},end:{x:enemy.x+150,y:enemy.y},speed:900}],()=>{cuts++})
  assert.equal(cuts,1);assert.equal(enemy.active,false)
  assert.equal(system.fragmentMesh.count,8);assert.equal(system.bloodMesh.count,42)
  const fragmentGeometry=system.fragmentMesh.geometry,bloodGeometry=system.bloodMesh.geometry
  for(let i=0;i<180;i++)system.update(402+i*16,1/60,1280,720,[],()=>{})
  assert.equal(system.fragmentMesh.geometry,fragmentGeometry);assert.equal(system.bloodMesh.geometry,bloodGeometry)
  assert.ok(system.fragmentMesh.instanceMatrix.array.every(Number.isFinite))
  assert.ok(system.bloodMesh.instanceMatrix.array.every(Number.isFinite))
})
