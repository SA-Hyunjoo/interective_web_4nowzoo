type Side = 'player' | 'cpu'
type FighterState = 'idle' | 'run' | 'jump' | 'attack' | 'hit' | 'defend'

interface Fighter {
  side: Side
  x: number
  y: number
  vx: number
  vy: number
  width: number
  height: number
  facing: number
  state: FighterState
  stateUntil: number
  onGround: boolean
  step: number
}

interface BrainBall {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  rotation: number
  spin: number
  owner: Side
  squash: number
  age: number
  scored: boolean
  groundHits: number
  removeAt: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  rotation: number
  color: string
  kind: 'star' | 'drop' | 'dust'
}

export interface BrainGameController {
  resize: () => void
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const random = (min: number, max: number): number => min + Math.random() * (max - min)

export function setupBrainGame(container: HTMLElement, isActive: () => boolean): BrainGameController {
  const canvas = container.querySelector<HTMLCanvasElement>('#brainCanvas')!
  const context = canvas.getContext('2d')!
  const playerScoreElement = container.querySelector<HTMLElement>('#brainPlayerScore')!
  const cpuScoreElement = container.querySelector<HTMLElement>('#brainCpuScore')!
  const comboElement = container.querySelector<HTMLElement>('#brainCombo')!
  const statusElement = container.querySelector<HTMLElement>('#brainRoundStatus')!
  const overlay = container.querySelector<HTMLElement>('#brainGameOver')!
  const resultTitle = container.querySelector<HTMLElement>('#brainResultTitle')!
  const resultCopy = container.querySelector<HTMLElement>('#brainResultCopy')!
  const restartButton = container.querySelector<HTMLButtonElement>('#brainRestart')!
  const touchButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-brain-control]'))

  let width = 1280
  let height = 720
  let groundY = 640
  let lastTime = performance.now()
  let elapsed = 0
  let playerScore = 0
  let cpuScore = 0
  let combo = 0
  let gameOver = false
  let playerThrowReadyAt = 0
  let cpuThrowAt = 2.1
  let cpuDecisionAt = 0
  let shake = 0
  let flash = 0
  let messageUntil = 0
  let player: Fighter
  let cpu: Fighter
  let brains: BrainBall[] = []
  let particles: Particle[] = []
  const held = new Set<string>()

  const brainSource = new Image()
  let brainSprite: CanvasImageSource | null = null
  brainSource.addEventListener('load', () => {
    const buffer = document.createElement('canvas')
    buffer.width = brainSource.naturalWidth
    buffer.height = brainSource.naturalHeight
    const bufferContext = buffer.getContext('2d', { willReadFrequently: true })!
    bufferContext.drawImage(brainSource, 0, 0)
    const pixels = bufferContext.getImageData(0, 0, buffer.width, buffer.height)
    for (let index = 0; index < pixels.data.length; index += 4) {
      const red = pixels.data[index]
      const green = pixels.data[index + 1]
      const blue = pixels.data[index + 2]
      const brightness = (red + green + blue) / 3
      const saturation = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (brightness > 220 && saturation < 24) pixels.data[index + 3] = 0
    }
    bufferContext.putImageData(pixels, 0, 0)
    brainSprite = buffer
  })
  brainSource.src = '/assets/brain-source.png'

  function makeFighter(side: Side): Fighter {
    return {
      side,
      x: side === 'player' ? width * 0.17 : width * 0.83,
      y: groundY,
      vx: 0,
      vy: 0,
      width: clamp(width * 0.085, 72, 112),
      height: clamp(height * 0.29, 150, 218),
      facing: side === 'player' ? 1 : -1,
      state: 'idle',
      stateUntil: 0,
      onGround: true,
      step: 0,
    }
  }

  function setMessage(message: string, duration = 1): void {
    statusElement.textContent = message
    messageUntil = elapsed + duration
  }

  function updateHud(): void {
    playerScoreElement.textContent = String(playerScore).padStart(4, '0')
    cpuScoreElement.textContent = String(cpuScore).padStart(4, '0')
    comboElement.textContent = `×${combo}`
  }

  function resetGame(): void {
    elapsed = 0
    playerScore = 0
    cpuScore = 0
    combo = 0
    gameOver = false
    playerThrowReadyAt = 0
    cpuThrowAt = 2.2
    cpuDecisionAt = 0
    shake = 0
    flash = 0
    brains = []
    particles = []
    held.clear()
    player = makeFighter('player')
    cpu = makeFighter('cpu')
    overlay.hidden = true
    setMessage('빈 머리를 지켜라!  SPACE로 뇌 던지기', 2.4)
    updateHud()
  }

  function headCenter(fighter: Fighter): { x: number; y: number } {
    return { x: fighter.x, y: fighter.y - fighter.height + fighter.width * 0.48 }
  }

  function openingCenter(fighter: Fighter): { x: number; y: number } {
    const head = headCenter(fighter)
    return { x: head.x, y: head.y - fighter.width * 0.33 }
  }

  function setFighterState(fighter: Fighter, state: FighterState, duration: number): void {
    fighter.state = state
    fighter.stateUntil = elapsed + duration
  }

  function throwBrain(owner: Side): void {
    if (gameOver) return
    const thrower = owner === 'player' ? player : cpu
    const target = owner === 'player' ? cpu : player
    if (owner === 'player' && elapsed < playerThrowReadyAt) return
    const startHead = headCenter(thrower)
    const targetOpening = openingCenter(target)
    const difficulty = clamp(elapsed / 55, 0, 1)
    const error = owner === 'cpu' ? 78 - difficulty * 58 : 34
    const flightTime = random(0.82, 1.08)
    const targetX = targetOpening.x + random(-error, error)
    const targetY = targetOpening.y + random(-error * 0.35, error * 0.48)
    const gravity = height * 0.92
    const vx = (targetX - (startHead.x + thrower.facing * thrower.width * 0.5)) / flightTime
    const vy = (targetY - startHead.y - gravity * flightTime * flightTime * 0.5) / flightTime
    brains.push({
      x: startHead.x + thrower.facing * thrower.width * 0.52,
      y: startHead.y + thrower.width * 0.36,
      vx: vx * random(0.96, 1.04),
      vy: vy * random(0.96, 1.04),
      radius: clamp(width * 0.019, 15, 24),
      rotation: random(-Math.PI, Math.PI),
      spin: random(-9, 9) || 6,
      owner,
      squash: 0,
      age: 0,
      scored: false,
      groundHits: 0,
      removeAt: Infinity,
    })
    setFighterState(thrower, 'attack', 0.38)
    if (owner === 'player') playerThrowReadyAt = elapsed + 0.72
    burst(startHead.x + thrower.facing * thrower.width * 0.62, startHead.y + thrower.width * 0.35, 'dust', 5)
  }

  function burst(x: number, y: number, kind: Particle['kind'], count: number): void {
    const palette = kind === 'star' ? ['#fff56e', '#ff9c43', '#f84f9b', '#74e3ff'] : kind === 'drop' ? ['#df1748', '#ff3d68', '#a80938'] : ['#e9d7a5', '#a7a09a']
    for (let index = 0; index < count; index += 1) {
      const angle = random(-Math.PI, Math.PI)
      const speed = random(65, kind === 'star' ? 250 : 175)
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - random(20, 100),
        life: random(0.35, 0.85),
        maxLife: 1,
        size: random(3, kind === 'star' ? 11 : 7),
        rotation: random(0, Math.PI * 2),
        color: palette[Math.floor(Math.random() * palette.length)],
        kind,
      })
    }
  }

  function finishMatch(winner: Side): void {
    if (gameOver) return
    gameOver = true
    shake = 18
    flash = 0.7
    const loser = winner === 'player' ? cpu : player
    const opening = openingCenter(loser)
    burst(opening.x, opening.y, 'star', 30)
    setFighterState(loser, 'hit', 99)
    setFighterState(winner === 'player' ? player : cpu, 'attack', 99)
    resultTitle.textContent = winner === 'player' ? 'PLAYER WIN!' : 'CPU WIN!'
    resultCopy.textContent = winner === 'player' ? '상대의 빈 머리에 지식을 강제로 넣었습니다.' : '당신의 머리에 뇌가 들어가 버렸습니다.'
    overlay.hidden = false
  }

  function scoreHit(brain: BrainBall, target: Fighter, kind: 'head' | 'body'): void {
    if (brain.scored) return
    brain.scored = true
    brain.removeAt = elapsed + 0.24
    const points = kind === 'head' ? 100 : 30
    if (brain.owner === 'player') {
      playerScore += points
      combo = kind === 'head' ? combo + 1 : 0
    } else {
      cpuScore += points
      if (kind !== 'head') combo = 0
    }
    const center = headCenter(target)
    setFighterState(target, kind === 'head' ? 'hit' : 'defend', 0.62)
    brain.vx *= -0.48
    brain.vy = -Math.abs(brain.vy) * 0.34 - 80
    brain.squash = 1
    shake = kind === 'head' ? 13 : 7
    flash = kind === 'head' ? 0.35 : 0.16
    burst(brain.x, brain.y, 'star', kind === 'head' ? 18 : 8)
    if (kind === 'head') burst(center.x, center.y, 'drop', 10)
    setMessage(kind === 'head' ? `HEAD HIT  +100${brain.owner === 'player' && combo > 1 ? `  ${combo} COMBO!` : ''}` : 'BODY HIT  +30', 1.1)
    updateHud()
  }

  function checkBrainHit(brain: BrainBall): void {
    if (brain.scored || gameOver || brain.age < 0.08) return
    const target = brain.owner === 'player' ? cpu : player
    const opening = openingCenter(target)
    const openingX = target.width * 0.2 + brain.radius * 0.18
    const openingY = target.width * 0.1 + brain.radius * 0.16
    const inOpening = Math.abs(brain.x - opening.x) < openingX && Math.abs(brain.y - opening.y) < openingY && brain.vy > -220
    if (inOpening) {
      brain.scored = true
      finishMatch(brain.owner)
      return
    }
    const head = headCenter(target)
    const headRadius = target.width * 0.41
    if (Math.hypot(brain.x - head.x, brain.y - head.y) < headRadius + brain.radius * 0.72) {
      scoreHit(brain, target, 'head')
      return
    }
    const bodyLeft = target.x - target.width * 0.4
    const bodyTop = target.y - target.height * 0.54
    const bodyRight = target.x + target.width * 0.4
    const bodyBottom = target.y - 12
    if (brain.x + brain.radius > bodyLeft && brain.x - brain.radius < bodyRight && brain.y + brain.radius > bodyTop && brain.y - brain.radius < bodyBottom) scoreHit(brain, target, 'body')
  }

  function updateFighter(fighter: Fighter, dt: number): void {
    const speed = width * 0.24
    if (fighter.side === 'player') {
      const direction = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0)
      fighter.vx += (direction * speed - fighter.vx) * Math.min(1, dt * 12)
      if (direction !== 0 && fighter.state !== 'attack') fighter.state = 'run'
      else if (fighter.onGround && elapsed > fighter.stateUntil) fighter.state = 'idle'
    }
    fighter.vy += height * 1.82 * dt
    fighter.x += fighter.vx * dt
    fighter.y += fighter.vy * dt
    const sideMin = fighter.side === 'player' ? fighter.width * 0.55 : width * 0.52
    const sideMax = fighter.side === 'player' ? width * 0.48 : width - fighter.width * 0.55
    fighter.x = clamp(fighter.x, sideMin, sideMax)
    if (fighter.y >= groundY) {
      fighter.y = groundY
      fighter.vy = 0
      fighter.onGround = true
    } else {
      fighter.onGround = false
      if (fighter.state !== 'attack' && fighter.state !== 'hit') fighter.state = 'jump'
    }
    if (elapsed > fighter.stateUntil && fighter.onGround && fighter.state !== 'run') fighter.state = 'idle'
    fighter.step += Math.abs(fighter.vx) * dt * 0.055
  }

  function updateCpu(dt: number): void {
    if (elapsed >= cpuDecisionAt) {
      cpuDecisionAt = elapsed + random(0.35, 0.8)
      const incoming = brains.find((brain) => brain.owner === 'player' && brain.vx > 0 && brain.x > width * 0.48)
      if (incoming) {
        const dodgeDirection = incoming.y < headCenter(cpu).y + 30 ? (Math.random() < 0.55 ? -1 : 1) : 0
        cpu.vx = dodgeDirection * width * random(0.12, 0.22)
        setFighterState(cpu, 'defend', 0.45)
        if (Math.random() < 0.34 && cpu.onGround) {
          cpu.vy = -height * 0.7
          cpu.onGround = false
        }
      } else {
        const home = width * random(0.72, 0.88)
        cpu.vx += Math.sign(home - cpu.x) * width * 0.035
        cpu.vx = clamp(cpu.vx, -width * 0.13, width * 0.13)
      }
    }
    cpu.vx *= Math.pow(0.24, dt)
    if (elapsed >= cpuThrowAt) {
      throwBrain('cpu')
      cpuThrowAt = elapsed + random(Math.max(1.15, 2.65 - elapsed * 0.012), Math.max(1.7, 3.55 - elapsed * 0.014))
    }
  }

  function updateBrain(brain: BrainBall, dt: number): void {
    brain.age += dt
    brain.vy += height * 0.92 * dt
    brain.x += brain.vx * dt
    brain.y += brain.vy * dt
    brain.rotation += brain.spin * dt
    brain.squash = Math.max(0, brain.squash - dt * 5.4)
    if (brain.x - brain.radius < 0 || brain.x + brain.radius > width) {
      brain.x = clamp(brain.x, brain.radius, width - brain.radius)
      brain.vx *= -0.58
      brain.spin *= -0.8
      brain.squash = 0.7
    }
    const ceiling = height * 0.055
    if (brain.y - brain.radius < ceiling) {
      brain.y = ceiling + brain.radius
      brain.vy = Math.abs(brain.vy) * 0.52
      brain.squash = 0.75
    }
    checkBrainHit(brain)
    if (brain.y + brain.radius >= groundY) {
      brain.y = groundY - brain.radius
      if (brain.groundHits === 0 && !brain.scored) {
        if (brain.owner === 'player') combo = 0
        setMessage('MISS  +0', 0.72)
        updateHud()
        burst(brain.x, groundY, 'dust', 9)
      }
      brain.groundHits += 1
      brain.vy = -Math.abs(brain.vy) * 0.34
      brain.vx *= 0.72
      brain.spin *= 0.68
      brain.squash = 1
      if (brain.groundHits >= 2 || Math.abs(brain.vy) < 55) brain.removeAt = Math.min(brain.removeAt, elapsed + 0.24)
    }
  }

  function updateParticles(dt: number): void {
    particles.forEach((particle) => {
      particle.life -= dt
      particle.vy += height * (particle.kind === 'star' ? 0.62 : 0.84) * dt
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.rotation += dt * 5
    })
    particles = particles.filter((particle) => particle.life > 0)
  }

  function update(dt: number): void {
    if (gameOver) {
      updateParticles(dt)
      shake = Math.max(0, shake - dt * 34)
      flash = Math.max(0, flash - dt * 2.4)
      return
    }
    elapsed += dt
    updateCpu(dt)
    updateFighter(player, dt)
    updateFighter(cpu, dt)
    brains.forEach((brain) => updateBrain(brain, dt))
    brains = brains.filter((brain) => elapsed < brain.removeAt)
    updateParticles(dt)
    shake = Math.max(0, shake - dt * 38)
    flash = Math.max(0, flash - dt * 2.6)
    if (elapsed > messageUntil) statusElement.textContent = elapsed < playerThrowReadyAt ? '뇌 재장전 중…' : 'SPACE로 뇌를 던지세요'
  }

  function roundedRect(x: number, y: number, w: number, h: number, radius: number): void {
    context.beginPath()
    context.roundRect(x, y, w, h, radius)
  }

  function drawBackground(): void {
    const wall = context.createLinearGradient(0, 0, 0, groundY)
    wall.addColorStop(0, '#777b7c')
    wall.addColorStop(0.62, '#9a978d')
    wall.addColorStop(1, '#77736c')
    context.fillStyle = wall
    context.fillRect(0, 0, width, groundY)

    context.fillStyle = 'rgba(37, 43, 45, 0.32)'
    for (let x = 0; x < width; x += width / 7) context.fillRect(x, height * 0.23, 2, groundY - height * 0.23)
    context.fillStyle = '#e9e4c6'
    context.shadowColor = '#fff5ba'
    context.shadowBlur = 20
    for (let index = 0; index < 4; index += 1) {
      roundedRect(width * (0.1 + index * 0.24), height * 0.04, width * 0.15, height * 0.028, 5)
      context.fill()
    }
    context.shadowBlur = 0

    context.fillStyle = '#5b605e'
    roundedRect(width * 0.43, height * 0.12, width * 0.14, height * 0.12, 6)
    context.fill()
    context.fillStyle = '#d8d2b5'
    context.font = `900 ${Math.max(10, width * 0.012)}px sans-serif`
    context.textAlign = 'center'
    context.fillText('WORK HARDER!', width * 0.5, height * 0.17)
    context.font = `700 ${Math.max(8, width * 0.008)}px sans-serif`
    context.fillText('NO BRAIN · NO PAIN', width * 0.5, height * 0.205)

    context.fillStyle = '#626663'
    for (const x of [width * 0.08, width * 0.78]) {
      roundedRect(x, groundY - height * 0.23, width * 0.14, height * 0.19, 8)
      context.fill()
      context.fillStyle = '#8d908a'
      context.fillRect(x + width * 0.015, groundY - height * 0.195, width * 0.11, 4)
      context.fillRect(x + width * 0.015, groundY - height * 0.13, width * 0.11, 4)
      context.fillStyle = '#626663'
    }

    const floor = context.createLinearGradient(0, groundY, 0, height)
    floor.addColorStop(0, '#4d4d49')
    floor.addColorStop(1, '#292c2d')
    context.fillStyle = floor
    context.fillRect(0, groundY, width, height - groundY)
    context.strokeStyle = 'rgba(204, 198, 171, 0.13)'
    context.lineWidth = 1
    for (let x = -width; x < width * 2; x += width * 0.095) {
      context.beginPath()
      context.moveTo(width / 2, groundY)
      context.lineTo(x, height)
      context.stroke()
    }
  }

  function drawFighter(fighter: Fighter): void {
    const head = headCenter(fighter)
    const scale = fighter.width / 100
    const bob = fighter.state === 'run' ? Math.sin(fighter.step) * 4 : fighter.state === 'idle' ? Math.sin(elapsed * 3 + (fighter.side === 'cpu' ? 1 : 0)) * 2 : 0
    const hitTilt = fighter.state === 'hit' ? Math.sin(elapsed * 42) * 0.12 : 0
    const attack = fighter.state === 'attack' ? fighter.facing * 20 * scale : 0
    context.save()
    context.translate(fighter.x, bob)
    context.rotate(hitTilt)
    context.shadowColor = 'rgba(0,0,0,.28)'
    context.shadowBlur = 12
    context.shadowOffsetY = 8

    context.strokeStyle = '#282f35'
    context.lineWidth = 11 * scale
    context.lineCap = 'round'
    const legSwing = fighter.state === 'run' ? Math.sin(fighter.step) * 13 * scale : 0
    context.beginPath()
    context.moveTo(-18 * scale, fighter.y - 53 * scale)
    context.lineTo(-22 * scale + legSwing, fighter.y - 4 * scale)
    context.moveTo(18 * scale, fighter.y - 53 * scale)
    context.lineTo(22 * scale - legSwing, fighter.y - 4 * scale)
    context.stroke()
    context.fillStyle = '#171b20'
    roundedRect(-36 * scale + legSwing, fighter.y - 10 * scale, 31 * scale, 12 * scale, 5 * scale)
    context.fill()
    roundedRect(5 * scale - legSwing, fighter.y - 10 * scale, 31 * scale, 12 * scale, 5 * scale)
    context.fill()

    const suit = context.createLinearGradient(-45 * scale, 0, 45 * scale, 0)
    suit.addColorStop(0, fighter.side === 'player' ? '#3c6490' : '#7d4b7b')
    suit.addColorStop(0.55, fighter.side === 'player' ? '#648fb6' : '#aa739f')
    suit.addColorStop(1, fighter.side === 'player' ? '#2f506f' : '#60395f')
    context.fillStyle = suit
    roundedRect(-45 * scale, fighter.y - 126 * scale, 90 * scale, 82 * scale, 21 * scale)
    context.fill()
    context.shadowBlur = 0
    context.fillStyle = '#ebe4d3'
    context.beginPath()
    context.moveTo(-16 * scale, fighter.y - 125 * scale)
    context.lineTo(0, fighter.y - 72 * scale)
    context.lineTo(16 * scale, fighter.y - 125 * scale)
    context.closePath()
    context.fill()
    context.fillStyle = '#df524b'
    context.beginPath()
    context.moveTo(-6 * scale, fighter.y - 112 * scale)
    context.lineTo(7 * scale, fighter.y - 112 * scale)
    context.lineTo(4 * scale, fighter.y - 76 * scale)
    context.lineTo(-4 * scale, fighter.y - 76 * scale)
    context.closePath()
    context.fill()

    context.strokeStyle = fighter.side === 'player' ? '#527da2' : '#8d5988'
    context.lineWidth = 15 * scale
    const armY = fighter.y - 105 * scale
    context.beginPath()
    context.moveTo(-37 * scale, armY)
    context.lineTo(-61 * scale - (fighter.facing < 0 ? attack : 0), armY + (fighter.state === 'defend' ? -26 : 30) * scale)
    context.moveTo(37 * scale, armY)
    context.lineTo(61 * scale + (fighter.facing > 0 ? attack : 0), armY + (fighter.state === 'defend' ? -26 : 30) * scale)
    context.stroke()

    const skin = context.createRadialGradient(head.x - fighter.x - 18 * scale, head.y - 24 * scale, 3, head.x - fighter.x, head.y, 58 * scale)
    skin.addColorStop(0, '#ffe0b8')
    skin.addColorStop(0.65, '#dba77d')
    skin.addColorStop(1, '#9b684f')
    context.fillStyle = skin
    context.beginPath()
    context.ellipse(0, head.y, 49 * scale, 54 * scale, 0, 0, Math.PI * 2)
    context.fill()

    context.fillStyle = '#2a1718'
    context.beginPath()
    context.ellipse(0, head.y - 35 * scale, 24 * scale, 10 * scale, 0, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = '#f0b48e'
    context.lineWidth = 5 * scale
    context.beginPath()
    context.ellipse(0, head.y - 35 * scale, 25 * scale, 11 * scale, 0, Math.PI, Math.PI * 2)
    context.stroke()

    context.fillStyle = '#f7f1df'
    context.beginPath()
    context.ellipse(-17 * scale, head.y - 5 * scale, 10 * scale, fighter.state === 'hit' ? 4 * scale : 13 * scale, 0, 0, Math.PI * 2)
    context.ellipse(17 * scale, head.y - 5 * scale, 10 * scale, fighter.state === 'hit' ? 4 * scale : 13 * scale, 0, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#1d2630'
    context.beginPath()
    context.arc(-14 * scale + fighter.facing * 3, head.y - 3 * scale, 4 * scale, 0, Math.PI * 2)
    context.arc(20 * scale + fighter.facing * 3, head.y - 3 * scale, 4 * scale, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = '#653f3b'
    context.lineWidth = 3 * scale
    context.beginPath()
    if (fighter.state === 'attack') context.arc(0, head.y + 23 * scale, 12 * scale, 0, Math.PI)
    else context.arc(0, head.y + 31 * scale, 12 * scale, Math.PI, Math.PI * 2)
    context.stroke()
    context.restore()
  }

  function drawBrain(brain: BrainBall): void {
    const squashX = 1 + brain.squash * 0.25
    const squashY = 1 - brain.squash * 0.22
    context.save()
    context.translate(brain.x, brain.y)
    context.rotate(brain.rotation)
    context.scale(squashX, squashY)
    context.shadowColor = 'rgba(111, 14, 48, 0.52)'
    context.shadowBlur = 13
    if (brainSprite) {
      context.drawImage(brainSprite, -brain.radius * 1.45, -brain.radius, brain.radius * 2.9, brain.radius * 2)
    } else {
      const fill = context.createRadialGradient(-brain.radius * 0.3, -brain.radius * 0.4, 2, 0, 0, brain.radius)
      fill.addColorStop(0, '#ffb4bd')
      fill.addColorStop(0.6, '#ec7185')
      fill.addColorStop(1, '#9d2d51')
      context.fillStyle = fill
      context.beginPath()
      context.ellipse(0, 0, brain.radius * 1.28, brain.radius, 0, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = 'rgba(119,25,60,.62)'
      context.lineWidth = 2
      for (let index = -2; index <= 2; index += 1) {
        context.beginPath()
        context.arc(index * brain.radius * 0.35, 0, brain.radius * 0.34, 0.2, Math.PI * 1.8)
        context.stroke()
      }
    }
    context.restore()
  }

  function drawParticle(particle: Particle): void {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1)
    context.save()
    context.globalAlpha = alpha
    context.translate(particle.x, particle.y)
    context.rotate(particle.rotation)
    context.fillStyle = particle.color
    if (particle.kind === 'star') {
      context.beginPath()
      for (let point = 0; point < 10; point += 1) {
        const radius = point % 2 === 0 ? particle.size : particle.size * 0.42
        const angle = -Math.PI / 2 + point * Math.PI / 5
        context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
      }
      context.closePath()
      context.fill()
    } else {
      context.beginPath()
      context.ellipse(0, 0, particle.size * (particle.kind === 'drop' ? 0.65 : 1), particle.size, 0, 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  }

  function draw(): void {
    context.clearRect(0, 0, width, height)
    context.save()
    if (shake > 0) context.translate(random(-shake, shake), random(-shake, shake))
    drawBackground()
    context.fillStyle = 'rgba(0,0,0,.25)'
    context.beginPath()
    context.ellipse(player.x, groundY + 4, player.width * 0.55, 13, 0, 0, Math.PI * 2)
    context.ellipse(cpu.x, groundY + 4, cpu.width * 0.55, 13, 0, 0, Math.PI * 2)
    context.fill()
    drawFighter(player)
    drawFighter(cpu)
    brains.forEach(drawBrain)
    particles.forEach(drawParticle)
    context.restore()
    if (flash > 0) {
      context.fillStyle = `rgba(255, 245, 153, ${flash * 0.34})`
      context.fillRect(0, 0, width, height)
    }
    context.fillStyle = 'rgba(255,255,255,.3)'
    context.font = `900 ${Math.max(10, width * 0.009)}px monospace`
    context.textAlign = 'center'
    context.fillText('←  → MOVE     ↑ JUMP     SPACE THROW', width / 2, height - 18)
  }

  function loop(now: number): void {
    const dt = Math.min(0.033, Math.max(0, (now - lastTime) / 1000))
    lastTime = now
    if (isActive() && !document.hidden) {
      update(dt)
      draw()
    }
    requestAnimationFrame(loop)
  }

  function jump(): void {
    if (!gameOver && player.onGround) {
      player.vy = -height * 0.78
      player.onGround = false
      setFighterState(player, 'jump', 0.5)
    }
  }

  function pressControl(control: string): void {
    if (control === 'ArrowUp') jump()
    else if (control === 'Space') throwBrain('player')
    else held.add(control)
    touchButtons.forEach((button) => button.classList.toggle('pressed', button.dataset.brainControl === control))
  }

  function releaseControl(control: string): void {
    held.delete(control)
    touchButtons.forEach((button) => {
      if (button.dataset.brainControl === control) button.classList.remove('pressed')
    })
  }

  window.addEventListener('keydown', (event) => {
    if (!isActive() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space'].includes(event.code)) return
    event.preventDefault()
    if (event.repeat && (event.code === 'ArrowUp' || event.code === 'Space')) return
    pressControl(event.code)
  })
  window.addEventListener('keyup', (event) => releaseControl(event.code))
  window.addEventListener('blur', () => {
    held.clear()
    touchButtons.forEach((button) => button.classList.remove('pressed'))
  })
  touchButtons.forEach((button) => {
    const control = button.dataset.brainControl!
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      button.setPointerCapture(event.pointerId)
      pressControl(control)
    })
    const release = (event: PointerEvent): void => {
      releaseControl(control)
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId)
    }
    button.addEventListener('pointerup', release)
    button.addEventListener('pointercancel', release)
  })
  restartButton.addEventListener('click', resetGame)

  function resize(): void {
    const bounds = canvas.getBoundingClientRect()
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
    width = Math.max(320, bounds.width)
    height = Math.max(340, bounds.height)
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    groundY = height * 0.87
    if (player && cpu) {
      player.y = Math.min(player.y, groundY)
      cpu.y = Math.min(cpu.y, groundY)
      player.width = cpu.width = clamp(width * 0.085, 72, 112)
      player.height = cpu.height = clamp(height * 0.29, 150, 218)
    }
    draw()
  }

  resetGame()
  resize()
  requestAnimationFrame(loop)
  return { resize }
}
