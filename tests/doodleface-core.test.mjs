import test from 'node:test'
import assert from 'node:assert/strict'
import { Drawing, FACE_OVAL, Pinch, Round, TIMING, anchorPoint, coverTransform, fromPanel, insideFace, localPoint, makePose, playerFor, predictPose, resolveAnchor, toPanel } from '../src/doodleface-core.ts'
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`)
function face() {
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }))
  FACE_OVAL.forEach((index, i) => { const angle = i / FACE_OVAL.length * Math.PI * 2; points[index] = { x: .5 + Math.sin(angle) * .3, y: .5 - Math.cos(angle) * .35 } })
  return makePose(points, 100, 8 / 9)
}
test('mirrored half ownership is positional, including exactly x=.5', () => {
  assert.equal(playerFor([{ x: .75, y: .3 }]), 0)
  assert.equal(playerFor([{ x: .25, y: .3 }]), 1)
  assert.equal(playerFor([{ x: .5, y: .3 }]), 1)
  assert.deepEqual(localPoint({ x: .75, y: .3 }, 0), { x: .5, y: .3 })
  assert.deepEqual(localPoint({ x: .25, y: .3 }, 1), { x: .5, y: .3 })
})
test('cover uses exactly one half and its forward/inverse match on portrait and landscape', () => {
  for (const [w,h] of [[520,420],[350,200],[300,600]]) {
    const t = coverTransform(w,h,960,540)
    close(t.w / t.h,480/540)
    assert.ok(t.w >= w && t.h >= h)
    const p = { x:.3,y:.4 }, restored = fromPanel(toPanel(p,t),t)
    close(restored.x,p.x); close(restored.y,p.y)
  }
})
test('anchors follow translation, rotation, scale and nearest-landmark expression', () => {
  const pose = face(), p = { x: .43,y: .36 }, a = anchorPoint(p,pose)
  const restored = resolveAnchor(a,pose); close(restored.x,p.x); close(restored.y,p.y)
  const angle=.7, size=1.4, c=Math.cos(angle), s=Math.sin(angle)
  const move = p => ({x: .6+((p.x-.5)*pose.aspect*c-(p.y-.5)*s)*size/pose.aspect,y:.4+((p.x-.5)*pose.aspect*s+(p.y-.5)*c)*size})
  const moved = makePose(pose.points.map(move),200,pose.aspect)
  const actual=resolveAnchor(a,moved), expected=move(p)
  close(actual.x,expected.x); close(actual.y,expected.y)
  moved.points[a.landmark].x += .02
  close(resolveAnchor(a,moved).x,expected.x+.02)
})
test('drawing must begin inside the face but can continue outside until release', () => {
  const pose = face(), drawing = new Drawing()
  assert.equal(insideFace({x:.5,y:.5},pose),true)
  drawing.start({x:0,y:0},pose,'red'); drawing.append({x:.5,y:.5},pose)
  assert.equal(drawing.strokes.length,0)
  drawing.start({x:.5,y:.5},pose,'red'); drawing.append({x:1,y:1},pose)
  assert.equal(drawing.strokes[0].points.length,2)
  drawing.end(); drawing.append({x:.4,y:.4},pose)
  assert.equal(drawing.strokes[0].points.length,2)
})
test('pinch has generous onset, hysteresis, sustained release and 220ms disappearance grace', () => {
  const pinch = new Pinch(), p={x:.5,y:.5}
  assert.equal(pinch.update(p,.47,0).started,true)
  pinch.update(p,.6,20); assert.equal(pinch.down,true)
  pinch.update(p,.8,30); pinch.update(p,.8,139); assert.equal(pinch.down,true)
  assert.equal(pinch.update(p,.8,140).ended,true)
  pinch.update(p,.3,200); pinch.update(null,1,420)
  assert.equal(pinch.down,true); assert.deepEqual(pinch.point,p)
  assert.equal(pinch.update(null,1,421).ended,true); assert.equal(pinch.point,null)
})
test('missing hand observations do not count toward stable release', () => {
  const g=new Pinch(), p={x:.5,y:.5}
  g.update(p,.3,0); g.update(p,.8,40); g.update(null,1,100); g.update(p,.8,155)
  assert.equal(g.down,true); g.update(p,.8,265); assert.equal(g.down,false)
})
test('round requires stable faces, resets unstable countdown, and waits for actual swap completion', () => {
  const r=new Round(); r.enter('waiting',0)
  r.tick(0,true); r.tick(649,true); assert.equal(r.phase,'waiting')
  r.tick(650,true); assert.equal(r.phase,'countdown')
  r.tick(1000,false); assert.equal(r.phase,'waiting')
  r.tick(1100,true); r.tick(1750,true); r.tick(6749,true); assert.equal(r.phase,'countdown')
  r.tick(6750,true); assert.equal(r.phase,'swapping')
  r.tick(20000,true); assert.equal(r.phase,'swapping')
  r.finishSwap(20000); assert.equal(r.seconds(20000),60)
  r.tick(79999,true); assert.equal(r.phase,'playing')
  r.tick(80000,true); assert.equal(r.phase,'result')
  r.tick(92399,true); assert.equal(r.phase,'result')
  r.tick(92400,true); assert.equal(r.phase,'lobby')
  assert.equal(TIMING.result-TIMING.notice,10000)
})
test('prediction extrapolates two poses briefly with bounded movement', () => {
  const prev=face(), curr=makePose(prev.points.map(p=>({x:p.x+.01,y:p.y})),200,prev.aspect)
  const predicted=predictPose(curr,prev,240)
  assert.ok(predicted.points[0].x>curr.points[0].x)
  assert.ok(predictPose(curr,prev,10000).points[0].x-curr.points[0].x<.001)
  assert.equal(predictPose(curr,null,240),curr)
})
