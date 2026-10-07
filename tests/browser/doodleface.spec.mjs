import { test, expect } from '@playwright/test'
const mockVision = `
import { FACE_OVAL } from '/src/doodleface-core.ts'
const stats = window.visionStats = { created: [], closed: [], calls: [] }
window.testFaces = true; window.testHands = false
function face(side) {
  const p = Array.from({length:478},()=>({x:.5,y:.5,z:0}))
  FACE_OVAL.forEach((n,i)=> {const a=i/FACE_OVAL.length*Math.PI*2; p[n]={x:.5+Math.sin(a)*.3,y:.5-Math.cos(a)*.35,z:0}})
  return p.map(p=>({...p,x:1-(p.x+side)/2}))
}
function hand(side) {
  const x = window.penX ?? .5, y = window.penY ?? .5
  const p=Array.from({length:21},()=>({x,y,z:0})); p[5]={x:x-.12,y:y+.15}; p[17]={x:x+.12,y:y+.15}
  p[4]={x:x-(window.openPinch?.2:.015),y}; p[8]={x:x+(window.openPinch?.2:.015),y}
  return p.map(p=>({...p,x:1-(p.x+side)/2}))
}
export const FilesetResolver={forVisionTasks:async path=>{window.wasmPath=path; return {}}}
export class FaceLandmarker {
 static async createFromOptions(_,options) { stats.created.push(['face',options]); if (window.failModels || (window.failGPU && options.baseOptions.delegate==='GPU')) throw Error('test failure'); if(window.modelDelay) await new Promise(r=>setTimeout(r,window.modelDelay)); return new FaceLandmarker() }
 detectForVideo(_,at) { stats.calls.push(['face',at]); return {faceLandmarks:window.testFaces?[face(1),face(0)]:[]} }
 close() {stats.closed.push('face')}
}
export class HandLandmarker {
 static async createFromOptions(_,options) { stats.created.push(['hand',options]); if (window.failModels || (window.failHandGPU && options.baseOptions.delegate==='GPU')) throw Error('test failure'); return new HandLandmarker() }
 detectForVideo(_,at) { stats.calls.push(['hand',at]); return {landmarks:window.testHands?(window.handOnly===0?[hand(0)]:[hand(1),hand(0)]):[]} }
 close() {stats.closed.push('hand')}
}
`
async function camera(page) {
  await page.addInitScript(() => {
    window.cameraCalls = []; window.cameraTracks = []
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.cameraCalls.push(constraints)
      if(window.denyCamera) throw new DOMException('denied','NotAllowedError')
      if(window.cameraDelay) await new Promise(r=>setTimeout(r,window.cameraDelay))
      const c=document.createElement('canvas'); c.width=960;c.height=540
      const ctx=c.getContext('2d');ctx.fillStyle='#dd3344';ctx.fillRect(0,0,480,540);ctx.fillStyle='#3355dd';ctx.fillRect(480,0,480,540)
      // Asymmetric stripes expose mirroring and unintended full-frame crop.
      ctx.fillStyle='#ffff00';ctx.fillRect(0,0,40,540);ctx.fillStyle='#00ffff';ctx.fillRect(920,0,40,540)
      const stream=c.captureStream(30); window.cameraTracks.push(...stream.getTracks())
      const update=()=> { if(stream.getVideoTracks()[0].readyState==='ended') return; ctx.fillStyle='#000';ctx.fillRect(479,0,2,1);requestAnimationFrame(update) };update()
      return stream
    }
  })
}
async function mock(page) {
  await camera(page)
  await page.route(/.*\/node_modules\/\.vite\/deps\/@mediapipe_tasks-vision\.js.*/, r=>r.fulfill({contentType:'application/javascript',body:mockVision}))
}
async function lobby(page) { await page.goto('/#doodleface'); await expect(page.locator('.df-start')).toBeVisible() }
async function start(page) { await page.locator('.df-start').click(); await expect(page.locator('.df-shell')).toHaveAttribute('data-phase',/waiting|countdown/) }
async function play(page) { await start(page); await expect(page.locator('.df-shell')).toHaveAttribute('data-phase','playing',{timeout:15000}) }
const pixel = (page,index,x=.5,y=.5) => page.locator('.df-camera').nth(index).evaluate((c,{x,y})=>Array.from(c.getContext('2d').getImageData(c.width*x,c.height*y,1,1).data),{x,y})

test('archive route, lobby, help, independent palette and mobile layout', async ({page}) => {
  await lobby(page)
  await expect(page.getByRole('tab',{name:/DoodleFace/})).toHaveAttribute('aria-selected','true')
  await expect(page.locator('.df-palette button')).toHaveCount(20)
  await page.locator('.df-help').click(); await expect(page.locator('dialog')).toBeVisible()
  await page.keyboard.press('Escape'); await expect(page.locator('dialog')).not.toBeVisible()
  await page.locator('.df-palette').first().getByRole('button',{name:'그린',exact:true}).click()
  await expect(page.locator('.df-palette').first().getByRole('button',{name:'그린',exact:true})).toHaveAttribute('aria-pressed','true')
  await expect(page.locator('.df-palette').nth(1).getByRole('button',{name:'블루',exact:true})).toHaveAttribute('aria-pressed','true')
  await page.screenshot({path:'test-results/doodleface-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  const boxes=await page.locator('.df-panel').evaluateAll(els=>els.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})))
  expect(boxes[1].x).toBe(boxes[0].x); expect(boxes[1].y).toBeGreaterThan(boxes[0].y)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/doodleface-mobile.png',fullPage:true})
  await page.getByRole('tab',{name:/타이핑게임/}).click(); await expect(page.locator('#typingGameView')).toBeVisible()
  await page.getByRole('tab',{name:/DoodleFace/}).click(); await expect(page.locator('.df-start')).toBeEnabled()
})

test('permission denial is Korean, retry opens one camera, waiting never obscures frames, leaving cleans up', async ({page}) => {
  await mock(page); await lobby(page); await page.evaluate(()=>window.denyCamera=true)
  await page.locator('.df-start').click(); await expect(page.locator('.df-notice')).toContainText('권한')
  await page.evaluate(()=>{window.denyCamera=false;window.testFaces=false})
  await start(page); await expect(page.locator('.df-wait').first()).toBeVisible()
  expect((await pixel(page,0)).slice(0,3)).toEqual([51,85,221]); expect((await pixel(page,1)).slice(0,3)).toEqual([221,51,68])
  expect((await pixel(page,0,.02)).slice(0,3)).toEqual([0,255,255]); expect((await pixel(page,1,.98)).slice(0,3)).toEqual([255,255,0])
  expect(await page.evaluate(()=>window.cameraCalls)).toHaveLength(2)
  expect(await page.evaluate(()=>window.cameraCalls[1].audio)).toBe(false)
  expect(await page.evaluate(()=>window.cameraCalls[1].video.facingMode)).toBe('user')
  await page.getByRole('tab',{name:/타이핑게임/}).click()
  expect(await page.evaluate(()=>window.cameraTracks.every(t=>t.readyState==='ended'))).toBe(true)
  expect(await page.evaluate(()=>window.visionStats.closed)).toEqual(['face','hand'])
  const count=await page.evaluate(()=>window.visionStats.calls.length); await page.waitForTimeout(300)
  expect(await page.evaluate(()=>window.visionStats.calls.length)).toBe(count)
})

for (const mobile of [false,true]) test(`full round ${mobile?'vertical':'horizontal'} slide, swapped camera, timer, drawing and automatic disposal`, async ({page}) => {
  await mock(page); if(mobile) await page.setViewportSize({width:390,height:844}); await lobby(page)
  await start(page); await expect(page.locator('.df-shell')).toHaveAttribute('data-phase','swapping',{timeout:12000})
  const animation = await page.locator('.df-swap-layer').first().evaluate(c=>({frames:c.getAnimations()[0].effect.getKeyframes(),timing:c.getAnimations()[0].effect.getTiming()}))
  expect(animation.timing.duration).toBe(850)
  expect(animation.frames[1].transform).toMatch(mobile?/translate\(0px, [1-9]/:/translate\([1-9].*, 0px\)/)
  await expect(page.locator('.df-clock strong')).toHaveText('01:00')
  await expect(page.locator('.df-shell')).toHaveAttribute('data-phase','playing')
  expect((await pixel(page,0)).slice(0,3)).toEqual([221,51,68]); expect((await pixel(page,1)).slice(0,3)).toEqual([51,85,221])
  await expect(page.locator('.df-face-label').first()).toHaveText('PLAYER 2')
  await expect(page.locator('.df-face-label').nth(1)).toHaveText('PLAYER 1')
  await page.evaluate(()=>window.testHands=true)
  await expect.poll(async()=> (await pixel(page,0)).slice(0,3)).toEqual([255,82,99])
  await page.evaluate(()=>{window.penX=.55;window.penY=.53})
  await page.waitForTimeout(300)
  await page.screenshot({path:`test-results/doodleface-playing-${mobile?'mobile':'desktop'}.png`})
  await page.evaluate(()=>window.testHands=false)
  await page.waitForTimeout(400)
  expect((await pixel(page,0)).slice(0,3)).toEqual([255,82,99]) // Ink remains after pencil disappears.
  const stats=await page.evaluate(()=>window.visionStats)
  expect(stats.created.filter(([kind])=>kind==='face')[0][1].numFaces).toBe(2)
  expect(stats.created.filter(([kind])=>kind==='hand')[0][1].numHands).toBe(2)
  expect(new Set(stats.calls.map(([,at])=>at)).size).toBe(stats.calls.length)
  expect(await page.evaluate(()=>window.cameraCalls.length)).toBe(1)
  // Advance the production monotonic clock after checking real animation completion.
  await page.evaluate(()=> {const base=performance.now.bind(performance); window.realNow=base; performance.now=()=>base()+61000; const original=requestAnimationFrame; window.requestAnimationFrame=fn=>original(t=>fn(t+61000))})
  await expect(page.locator('.df-shell')).toHaveAttribute('data-phase','result')
  await expect(page.locator('.df-notice')).toHaveText('완성된 얼굴을 보여주세요')
  await page.waitForTimeout(2500); await expect(page.locator('.df-notice')).toBeHidden()
  expect(await page.evaluate(()=>window.cameraTracks[0].readyState)).toBe('live')
  await page.evaluate(()=>{const original=requestAnimationFrame; window.requestAnimationFrame=fn=>original(t=>fn(t+12000))})
  await expect(page.locator('.df-shell')).toHaveAttribute('data-phase','lobby')
  expect(await page.evaluate(()=>window.cameraTracks[0].readyState)).toBe('ended')
  expect(await page.evaluate(()=>window.visionStats.closed)).toEqual(['face','hand'])
})

test('partial GPU failure closes the first model, then retries both on CPU', async ({page}) => {
  await mock(page); await lobby(page); await page.evaluate(()=>window.failHandGPU=true); await start(page)
  const stats=await page.evaluate(()=>window.visionStats)
  expect(stats.created.map(([kind,o])=>[kind,o.baseOptions.delegate])).toEqual([['face','GPU'],['hand','GPU'],['face','CPU'],['hand','CPU']])
  expect(stats.closed).toEqual(['face'])
  await page.locator('.df-exit').click(); expect(await page.evaluate(()=>window.visionStats.closed)).toEqual(['face','face','hand'])
})

test('model error is retryable and navigation during model creation closes late resources', async ({page}) => {
  await mock(page); await lobby(page); await page.evaluate(()=>window.failModels=true)
  await page.locator('.df-start').click(); await expect(page.locator('.df-notice')).toContainText('모델')
  expect(await page.evaluate(()=>window.cameraTracks[0].readyState)).toBe('ended')
  await page.evaluate(()=>{window.failModels=false;window.modelDelay=800})
  await page.locator('.df-start').click(); await expect.poll(()=>page.evaluate(()=>window.visionStats.created.length)).toBe(3)
  await page.getByRole('tab',{name:/타이핑게임/}).click(); await page.waitForTimeout(1100)
  expect(await page.evaluate(()=>window.cameraTracks.every(t=>t.readyState==='ended'))).toBe(true)
  expect(await page.evaluate(()=>window.visionStats.closed)).toEqual(['face'])
  expect(await page.evaluate(()=>window.visionStats.created.filter(([k])=>k==='hand').length)).toBe(0)
})

test('actual local WASM and models load with a synthetic camera, without external requests', async ({page, baseURL}) => {
  test.setTimeout(90000)
  await camera(page); const external=[],errors=[]
  page.on('request',r=>{if(!r.url().startsWith('data:')&&new URL(r.url()).origin!==new URL(baseURL).origin)external.push(r.url())})
  page.on('pageerror',e=>errors.push(e.message))
  await lobby(page); await page.locator('.df-start').click()
  await expect(page.locator('.df-shell')).toHaveAttribute('data-phase','waiting',{timeout:60000})
  await expect(page.locator('.df-wait').first()).toBeVisible()
  expect(external).toEqual([]);expect(errors).toEqual([])
  expect((await pixel(page,0)).slice(0,3)).toEqual([51,85,221])
  await page.locator('.df-exit').click(); expect(await page.evaluate(()=>window.cameraTracks[0].readyState)).toBe('ended')
})

test('pinching a palette selects only its player color and does not begin a stroke', async ({page}) => {
  await mock(page); await lobby(page); await play(page)
  await page.evaluate(async()=> {
    const {coverTransform,fromPanel}=await import('/src/doodleface-core.ts')
    const c=document.querySelector('.df-camera').getBoundingClientRect(), swatch=document.querySelector('.df-palette [data-color="5"]').getBoundingClientRect()
    const p=fromPanel({x:swatch.left+swatch.width/2-c.left,y:swatch.top+swatch.height/2-c.top},coverTransform(c.width,c.height,960,540))
    window.penX=p.x;window.penY=p.y;window.handOnly=0;window.testHands=true
  })
  await expect(page.locator('.df-palette').first().locator('[data-color="5"]')).toHaveAttribute('aria-pressed','true')
  await expect(page.locator('.df-palette').nth(1).locator('[data-color="7"]')).toHaveAttribute('aria-pressed','true')
  await page.evaluate(()=>{window.penX=.5;window.penY=.5}); await page.waitForTimeout(250)
  await page.evaluate(()=>window.testHands=false); await page.waitForTimeout(400)
  expect((await pixel(page,0)).slice(0,3)).toEqual([221,51,68])
})

test('late camera permission cannot resurrect a departed game; insecure context explains retry', async ({page}) => {
  await mock(page); await lobby(page); await page.evaluate(()=>window.cameraDelay=700)
  await page.locator('.df-start').click(); await page.getByRole('tab',{name:/타이핑게임/}).click()
  await page.waitForTimeout(1000)
  expect(await page.evaluate(()=>window.cameraTracks.every(t=>t.readyState==='ended'))).toBe(true)
  expect(await page.evaluate(()=>window.visionStats.created.length)).toBe(0)
  await page.getByRole('tab',{name:/DoodleFace/}).click(); await expect(page.locator('.df-start')).toBeVisible()
  await page.evaluate(()=>Object.defineProperty(window,'isSecureContext',{value:false,configurable:true}))
  await page.locator('.df-start').click(); await expect(page.locator('.df-notice')).toContainText('HTTPS')
  await expect(page.locator('.df-start')).toBeEnabled()
})

test('low power devices reduce camera fps, inference width and canvas DPR', async ({page}) => {
  await page.addInitScript(()=>Object.defineProperty(navigator,'hardwareConcurrency',{value:2}))
  await mock(page); await lobby(page); await start(page)
  expect(await page.evaluate(()=>window.cameraCalls[0].video.frameRate.max)).toBe(20)
  expect(await page.locator('.df-camera').first().evaluate(c=>c.width/c.getBoundingClientRect().width)).toBeLessThanOrEqual(1.01)
})
