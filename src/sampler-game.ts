type PadKey = 'q' | 'w' | 'e' | 'a' | 's' | 'd' | 'z' | 'x' | 'c'
type SampleSource = 'built-in' | 'public' | 'microphone'

interface PadState {
  key: PadKey
  buffer: AudioBuffer
  source: SampleSource
  pitch: number
  speed: number
  element: HTMLButtonElement
}

interface LoopEvent {
  key: PadKey
  offset: number
  duration: number
  pitch: number
  speed: number
}

interface LoopTrack {
  id: number
  name: string
  length: number
  events: LoopEvent[]
}

interface LoopPlayback {
  nextLoopAt: number
}

interface AudioVoice {
  key: PadKey
  source: AudioBufferSourceNode
  gain: GainNode
}

interface PendingNote {
  key: PadKey
  offset: number
  startedAt: number
  pitch: number
  speed: number
}

export interface SamplerGameController {
  resize: () => void
}

const PAD_KEYS: PadKey[] = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c']
const PAD_LABELS: Record<PadKey, string> = {
  q: 'KICK', w: 'SNARE', e: 'HI-HAT',
  a: 'BASS', s: 'CHORD', d: 'PLUCK',
  z: 'CLAP', x: 'TOM', c: 'BELL',
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

export function setupSamplerGame(container: HTMLElement, isActive: () => boolean): SamplerGameController {
  const statusElement = container.querySelector<HTMLElement>('#samplerStatus')!
  const samplingModeButton = container.querySelector<HTMLButtonElement>('#samplingModeButton')!
  const recordButton = container.querySelector<HTMLButtonElement>('#performanceRecordButton')!
  const recordingMeter = container.querySelector<HTMLElement>('#recordingMeter')!
  const recordingTimeElement = container.querySelector<HTMLElement>('#recordingTime')!
  const newLoopButton = container.querySelector<HTMLButtonElement>('#newLoopButton')!
  const loopListElement = container.querySelector<HTMLElement>('#loopList')!
  const editingPadKeyElement = container.querySelector<HTMLElement>('#editingPadKey')!
  const pitchValueElement = container.querySelector<HTMLElement>('#pitchValue')!
  const speedValueElement = container.querySelector<HTMLElement>('#speedValue')!
  const padElements = new Map<PadKey, HTMLButtonElement>(
    Array.from(container.querySelectorAll<HTMLButtonElement>('[data-pad-key]')).map((element) => [element.dataset.padKey as PadKey, element]),
  )

  const audioContext = new AudioContext({ latencyHint: 'interactive' })
  const masterGain = audioContext.createGain()
  masterGain.gain.value = 0.76
  const compressor = audioContext.createDynamicsCompressor()
  compressor.threshold.value = -12
  compressor.knee.value = 12
  compressor.ratio.value = 5
  compressor.attack.value = 0.002
  compressor.release.value = 0.16
  masterGain.connect(compressor).connect(audioContext.destination)

  function createBuiltInSample(key: PadKey): AudioBuffer {
    const durations: Record<PadKey, number> = { q: 0.55, w: 0.42, e: 0.2, a: 0.8, s: 1.1, d: 0.62, z: 0.44, x: 0.62, c: 1.25 }
    const length = Math.floor(audioContext.sampleRate * durations[key])
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate)
    const data = buffer.getChannelData(0)
    let phase = 0
    let previousNoise = 0

    for (let index = 0; index < length; index += 1) {
      const time = index / audioContext.sampleRate
      const progress = index / length
      const noise = Math.random() * 2 - 1
      let sample = 0
      if (key === 'q') {
        const frequency = 150 * Math.pow(0.28, progress) + 38
        phase += (Math.PI * 2 * frequency) / audioContext.sampleRate
        sample = Math.sin(phase) * Math.exp(-time * 8.5) + noise * Math.exp(-time * 45) * 0.12
      } else if (key === 'w') {
        sample = noise * Math.exp(-time * 12) * 0.68 + Math.sin(Math.PI * 2 * 185 * time) * Math.exp(-time * 18) * 0.3
      } else if (key === 'e') {
        const highNoise = noise - previousNoise * 0.92
        sample = highNoise * Math.exp(-time * 28) * 0.45
      } else if (key === 'a') {
        const frequency = 54.5
        sample = (Math.sin(Math.PI * 2 * frequency * time) + Math.sin(Math.PI * 4 * frequency * time) * 0.28) * Math.exp(-time * 3.4) * 0.62
      } else if (key === 's') {
        const frequencies = [220, 277.18, 329.63]
        sample = frequencies.reduce((sum, frequency) => sum + Math.sin(Math.PI * 2 * frequency * time), 0) / 3
        sample *= Math.min(1, time * 28) * Math.exp(-time * 2.3) * 0.55
      } else if (key === 'd') {
        sample = (Math.sin(Math.PI * 2 * 392 * time) + Math.sin(Math.PI * 2 * 784 * time) * 0.24) * Math.exp(-time * 8) * 0.58
      } else if (key === 'z') {
        const burst = [0, 0.075, 0.145].reduce((sum, start) => sum + (time >= start ? Math.exp(-(time - start) * 42) : 0), 0)
        sample = noise * burst * 0.38
      } else if (key === 'x') {
        const frequency = 165 - progress * 76
        phase += (Math.PI * 2 * frequency) / audioContext.sampleRate
        sample = Math.sin(phase) * Math.exp(-time * 5.8) * 0.68
      } else {
        sample = (Math.sin(Math.PI * 2 * 659.25 * time) + Math.sin(Math.PI * 2 * 987.77 * time) * 0.42) * Math.exp(-time * 3.6) * 0.52
      }
      data[index] = clamp(sample, -0.95, 0.95)
      previousNoise = noise
    }
    return buffer
  }

  const pads = new Map<PadKey, PadState>()
  PAD_KEYS.forEach((key) => {
    pads.set(key, {
      key,
      buffer: createBuiltInSample(key),
      source: 'built-in',
      pitch: 0,
      speed: 1,
      element: padElements.get(key)!,
    })
  })

  let editingKey: PadKey = 'q'
  let samplingMode = false
  let samplingKey: PadKey | null = null
  let microphoneStarting = false
  let microphoneStream: MediaStream | null = null
  let microphoneSource: MediaStreamAudioSourceNode | null = null
  let microphoneProcessor: ScriptProcessorNode | null = null
  let microphoneSilentGain: GainNode | null = null
  let microphoneChunks: Float32Array[] = []
  let microphoneSampleFrames = 0
  let microphoneStartedAt = 0
  let microphoneLimitTimer: number | null = null
  let loopId = 1
  let loops: LoopTrack[] = [{ id: loopId, name: 'LOOP 01', length: 0, events: [] }]
  let selectedLoopId = loopId
  let performanceRecording = false
  let performanceStartedAt = 0
  let baseLoopLength = 0
  let pendingEvents: LoopEvent[] = []
  const loopPlaybacks = new Map<number, LoopPlayback>()
  const heldKeyboardKeys = new Set<PadKey>()
  const pointerKeys = new Map<number, PadKey>()
  const padPointers = new Map<PadKey, Set<number>>()
  const longPressTimers = new Map<string, number>()
  const activeVoices = new Map<string, AudioVoice>()
  const activeRecordedNotes = new Map<string, PendingNote>()
  const scheduledLoopVoices = new Map<number, Set<AudioVoice>>()
  const loopVisualCounts = new Map<PadKey, number>()

  function setStatus(message: string, mode: 'normal' | 'sampling' | 'recording' | 'error' = 'normal'): void {
    statusElement.className = `sampler-status ${mode}`
    statusElement.querySelector('span')!.textContent = message
  }

  function sourceLabel(source: SampleSource): string {
    if (source === 'public') return 'PUBLIC FILE'
    if (source === 'microphone') return 'MIC SAMPLE'
    return 'BUILT-IN'
  }

  function updatePadSource(pad: PadState): void {
    pad.element.querySelector('span')!.textContent = sourceLabel(pad.source)
    pad.element.classList.toggle('custom-sample', pad.source !== 'built-in')
  }

  async function loadPublicSample(key: PadKey): Promise<void> {
    for (const extension of ['wav', 'mp3']) {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}samples/${key}.${extension}`)
        if (!response.ok) continue
        const buffer = await audioContext.decodeAudioData(await response.arrayBuffer())
        const pad = pads.get(key)!
        pad.buffer = buffer
        pad.source = 'public'
        updatePadSource(pad)
        return
      } catch {
        // Try the other supported extension, then keep the built-in sample.
      }
    }
  }
  PAD_KEYS.forEach((key) => void loadPublicSample(key))

  function setPadPressed(key: PadKey, pressed: boolean): void {
    pads.get(key)?.element.classList.toggle('pressed', pressed)
  }

  function pulsePad(key: PadKey, when: number, duration: number): void {
    const delay = Math.max(0, (when - audioContext.currentTime) * 1000)
    window.setTimeout(() => {
      const pad = pads.get(key)
      if (!pad || !isActive()) return
      loopVisualCounts.set(key, (loopVisualCounts.get(key) ?? 0) + 1)
      pad.element.classList.add('loop-pulse')
      window.setTimeout(() => {
        const remaining = Math.max(0, (loopVisualCounts.get(key) ?? 1) - 1)
        loopVisualCounts.set(key, remaining)
        if (remaining === 0) pad.element.classList.remove('loop-pulse')
      }, Math.max(45, duration * 1000))
    }, delay)
  }

  function createVoice(key: PadKey, when: number, pitch?: number, speed?: number): AudioVoice | null {
    const pad = pads.get(key)
    if (!pad) return null
    const source = audioContext.createBufferSource()
    const voiceGain = audioContext.createGain()
    source.buffer = pad.buffer
    source.detune.value = (pitch ?? pad.pitch) * 100
    source.playbackRate.value = speed ?? pad.speed
    voiceGain.gain.setValueAtTime(0.0001, when)
    voiceGain.gain.exponentialRampToValueAtTime(0.92, when + 0.005)
    source.connect(voiceGain).connect(masterGain)
    return { key, source, gain: voiceGain }
  }

  function releaseVoice(voice: AudioVoice, when = audioContext.currentTime): void {
    const releaseAt = Math.max(audioContext.currentTime, when)
    voice.gain.gain.cancelScheduledValues(releaseAt)
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), releaseAt)
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt + 0.018)
    try {
      voice.source.stop(releaseAt + 0.022)
    } catch {
      // The source may already have ended naturally.
    }
  }

  function beginRecordedNote(voiceId: string, key: PadKey): void {
    if (!performanceRecording || activeRecordedNotes.has(voiceId)) return
    const pad = pads.get(key)!
    const elapsed = Math.max(0, audioContext.currentTime - performanceStartedAt)
    const offset = baseLoopLength > 0 ? elapsed % baseLoopLength : elapsed
    activeRecordedNotes.set(voiceId, {
      key,
      offset,
      startedAt: audioContext.currentTime,
      pitch: pad.pitch,
      speed: pad.speed,
    })
  }

  function finishRecordedNote(voiceId: string, endedAt = audioContext.currentTime): void {
    const note = activeRecordedNotes.get(voiceId)
    if (!note) return
    activeRecordedNotes.delete(voiceId)
    const duration = Math.max(0.04, endedAt - note.startedAt)
    pendingEvents.push({ key: note.key, offset: note.offset, duration, pitch: note.pitch, speed: note.speed })
  }

  function startPadVoice(key: PadKey, voiceId: string): void {
    if (activeVoices.has(voiceId)) return
    void audioContext.resume()
    const when = audioContext.currentTime
    const voice = createVoice(key, when)
    if (!voice) return
    voice.source.loop = true
    activeVoices.set(voiceId, voice)
    voice.source.start(when)
    beginRecordedNote(voiceId, key)
  }

  function stopPadVoice(voiceId: string): void {
    const voice = activeVoices.get(voiceId)
    if (voice) {
      releaseVoice(voice)
      activeVoices.delete(voiceId)
    }
    finishRecordedNote(voiceId)
  }

  function previewSound(key: PadKey): void {
    const pad = pads.get(key)
    if (!pad) return
    const when = audioContext.currentTime
    const voice = createVoice(key, when)
    if (!voice) return
    const duration = Math.max(0.08, Math.min(0.42, pad.buffer.duration / pad.speed))
    voice.source.start(when)
    voice.gain.gain.setValueAtTime(0.92, when + 0.005)
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    voice.source.stop(when + duration + 0.02)
  }

  function playLoopEvent(loopId: number, event: LoopEvent, when: number): void {
    const duration = Math.max(0.04, event.duration || 0.12)
    const voice = createVoice(event.key, when, event.pitch, event.speed)
    if (!voice) return
    voice.source.loop = true
    let voices = scheduledLoopVoices.get(loopId)
    if (!voices) {
      voices = new Set()
      scheduledLoopVoices.set(loopId, voices)
    }
    voices.add(voice)
    voice.source.addEventListener('ended', () => {
      voices?.delete(voice)
      if (voices?.size === 0) scheduledLoopVoices.delete(loopId)
    }, { once: true })
    voice.source.start(when)
    voice.gain.gain.setValueAtTime(0.92, when + 0.005)
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    voice.source.stop(when + duration + 0.02)
    pulsePad(event.key, when, duration)
  }

  function stopScheduledLoopVoices(loopId: number): void {
    const voices = scheduledLoopVoices.get(loopId)
    if (!voices) return
    voices.forEach((voice) => releaseVoice(voice))
    scheduledLoopVoices.delete(loopId)
  }

  function selectedLoop(): LoopTrack {
    return loops.find((loop) => loop.id === selectedLoopId) ?? loops[0]
  }

  function renderEditor(): void {
    const pad = pads.get(editingKey)!
    editingPadKeyElement.textContent = editingKey.toUpperCase()
    pitchValueElement.textContent = `${pad.pitch > 0 ? '+' : ''}${pad.pitch} st`
    speedValueElement.textContent = `${pad.speed.toFixed(1)}×`
    pads.forEach((item) => item.element.classList.toggle('editing', item.key === editingKey))
  }

  function selectPadForEditing(key: PadKey): void {
    editingKey = key
    renderEditor()
    setStatus(`${key.toUpperCase()} 패드 편집 · ${PAD_LABELS[key]}`)
    container.querySelector<HTMLElement>('.sample-editor')?.classList.add('attention')
    window.setTimeout(() => container.querySelector<HTMLElement>('.sample-editor')?.classList.remove('attention'), 420)
  }

  function changePitch(amount: number): void {
    const pad = pads.get(editingKey)!
    pad.pitch = clamp(pad.pitch + amount, -12, 12)
    renderEditor()
    previewSound(editingKey)
  }

  function changeSpeed(amount: number): void {
    const pad = pads.get(editingKey)!
    pad.speed = Math.round(clamp(pad.speed + amount, 0.5, 2) * 10) / 10
    renderEditor()
    previewSound(editingKey)
  }

  container.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      void audioContext.resume()
      if (button.dataset.edit === 'pitch-down') changePitch(-1)
      else if (button.dataset.edit === 'pitch-up') changePitch(1)
      else if (button.dataset.edit === 'speed-down') changeSpeed(-0.1)
      else if (button.dataset.edit === 'speed-up') changeSpeed(0.1)
    })
  })

  function cancelLongPress(id: string): void {
    const timer = longPressTimers.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    longPressTimers.delete(id)
  }

  function beginLongPress(id: string, key: PadKey): void {
    cancelLongPress(id)
    longPressTimers.set(id, window.setTimeout(() => {
      longPressTimers.delete(id)
      selectPadForEditing(key)
    }, 620))
  }

  async function startMicrophoneSampling(key: PadKey): Promise<void> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      samplingMode = false
      samplingModeButton.classList.remove('active')
      setStatus('마이크 샘플링은 HTTPS 또는 localhost 환경에서 사용할 수 있어요.', 'error')
      return
    }
    samplingKey = key
    microphoneStarting = true
    const pad = pads.get(key)!
    pad.element.classList.add('sampling')
    setStatus(`${key.toUpperCase()} 패드 녹음 권한을 확인하고 있어요`, 'sampling')
    try {
      await audioContext.resume()
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      microphoneSource = audioContext.createMediaStreamSource(microphoneStream)
      microphoneProcessor = audioContext.createScriptProcessor(2048, 1, 1)
      microphoneSilentGain = audioContext.createGain()
      microphoneSilentGain.gain.value = 0
      microphoneChunks = []
      microphoneSampleFrames = 0
      microphoneProcessor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        const chunk = new Float32Array(input.length)
        chunk.set(input)
        microphoneChunks.push(chunk)
        microphoneSampleFrames += chunk.length
      }
      microphoneSource.connect(microphoneProcessor)
      microphoneProcessor.connect(microphoneSilentGain)
      microphoneSilentGain.connect(audioContext.destination)
      microphoneStartedAt = audioContext.currentTime
      microphoneStarting = false
      microphoneLimitTimer = window.setTimeout(stopMicrophoneSampling, 30_000)
      setStatus(`${key.toUpperCase()} 실제 마이크 녹음 중 · 같은 패드를 다시 누르면 완료`, 'sampling')
    } catch (error) {
      cleanupMicrophoneCapture()
      samplingKey = null
      samplingMode = false
      microphoneStarting = false
      samplingModeButton.classList.remove('active')
      pad.element.classList.remove('sampling')
      const errorName = error instanceof DOMException ? error.name : ''
      if (errorName === 'NotAllowedError') setStatus('브라우저 설정에서 마이크 권한을 허용해 주세요.', 'error')
      else if (errorName === 'NotFoundError') setStatus('사용할 수 있는 마이크를 찾지 못했어요.', 'error')
      else setStatus('마이크를 시작하지 못했어요. 연결 상태를 확인해 주세요.', 'error')
    }
  }

  function cleanupMicrophoneCapture(): void {
    if (microphoneLimitTimer !== null) window.clearTimeout(microphoneLimitTimer)
    microphoneLimitTimer = null
    if (microphoneProcessor) microphoneProcessor.onaudioprocess = null
    microphoneSource?.disconnect()
    microphoneProcessor?.disconnect()
    microphoneSilentGain?.disconnect()
    microphoneStream?.getTracks().forEach((track) => track.stop())
    microphoneStream = null
    microphoneSource = null
    microphoneProcessor = null
    microphoneSilentGain = null
  }

  function stopMicrophoneSampling(): void {
    if (microphoneStarting) {
      setStatus('마이크가 준비되는 중이에요. 잠시 후 다시 눌러 주세요.', 'sampling')
      return
    }
    const key = samplingKey
    if (!key || !microphoneProcessor) return
    const pad = pads.get(key)!
    const chunks = microphoneChunks
    const frameCount = microphoneSampleFrames
    const recordedSeconds = Math.max(0, audioContext.currentTime - microphoneStartedAt)
    cleanupMicrophoneCapture()
    microphoneChunks = []
    microphoneSampleFrames = 0
    samplingKey = null
    samplingMode = false
    samplingModeButton.classList.remove('active')
    pad.element.classList.remove('sampling')

    if (frameCount < audioContext.sampleRate * 0.08) {
      setStatus('녹음이 너무 짧아요. 0.1초 이상 녹음해 주세요.', 'error')
      return
    }
    const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate)
    const channel = buffer.getChannelData(0)
    let offset = 0
    chunks.forEach((chunk) => {
      channel.set(chunk, offset)
      offset += chunk.length
    })
    pad.buffer = buffer
    pad.source = 'microphone'
    updatePadSource(pad)
    setStatus(`${key.toUpperCase()} 패드에 실제 마이크 녹음 ${recordedSeconds.toFixed(1)}초를 설정했어요`)
  }

  function handlePadPress(key: PadKey, voiceId: string): void {
    if (samplingMode) {
      if (samplingKey === null) void startMicrophoneSampling(key)
      else if (samplingKey === key) stopMicrophoneSampling()
      else setStatus(`${samplingKey.toUpperCase()} 패드를 다시 눌러 녹음을 완료하세요`, 'sampling')
      return
    }
    startPadVoice(key, voiceId)
  }

  function handlePadRelease(voiceId: string): void {
    stopPadVoice(voiceId)
  }

  samplingModeButton.addEventListener('click', () => {
    if (samplingKey) {
      setStatus(`${samplingKey.toUpperCase()} 패드를 다시 눌러 녹음을 완료하세요`, 'sampling')
      return
    }
    samplingMode = !samplingMode
    samplingModeButton.classList.toggle('active', samplingMode)
    setStatus(samplingMode ? '샘플을 설정할 패드를 하나 누르세요' : '샘플링 모드를 취소했어요', samplingMode ? 'sampling' : 'normal')
  })

  function renderLoops(): void {
    loopListElement.innerHTML = ''
    loops.forEach((loop) => {
      const row = document.createElement('article')
      row.className = 'loop-row'
      row.classList.toggle('selected', loop.id === selectedLoopId)
      row.classList.toggle('playing', loopPlaybacks.has(loop.id))

      const selectButton = document.createElement('button')
      selectButton.type = 'button'
      selectButton.className = 'loop-select'
      const title = document.createElement('strong')
      title.textContent = loop.name
      const detail = document.createElement('span')
      detail.textContent = loop.events.length ? `${loop.events.length} notes · ${loop.length.toFixed(1)} sec` : 'EMPTY TRACK'
      selectButton.append(title, detail)
      selectButton.addEventListener('click', () => {
        if (performanceRecording) return
        selectedLoopId = loop.id
        renderLoops()
        setStatus(`${loop.name} 선택됨 · 녹음하면 레이어가 추가됩니다`)
      })

      const playButton = document.createElement('button')
      playButton.type = 'button'
      playButton.className = 'loop-play'
      playButton.disabled = loop.events.length === 0
      playButton.setAttribute('aria-label', `${loop.name} ${loopPlaybacks.has(loop.id) ? '반복재생 중지' : '반복재생'}`)
      playButton.textContent = loopPlaybacks.has(loop.id) ? '■' : '▶'
      playButton.addEventListener('click', () => toggleLoopPlayback(loop.id))

      const deleteButton = document.createElement('button')
      deleteButton.type = 'button'
      deleteButton.className = 'loop-delete'
      deleteButton.setAttribute('aria-label', `${loop.name} 삭제`)
      deleteButton.title = '녹음본 삭제'
      deleteButton.textContent = '×'
      deleteButton.addEventListener('click', () => deleteLoop(loop.id))
      row.append(selectButton, playButton, deleteButton)
      loopListElement.append(row)
    })
  }

  function deleteLoop(id: number): void {
    if (performanceRecording) {
      setStatus('녹음을 완료한 뒤 녹음본을 삭제해 주세요.', 'error')
      return
    }
    const target = loops.find((loop) => loop.id === id)
    if (!target) return
    loopPlaybacks.delete(id)
    stopScheduledLoopVoices(id)
    loops = loops.filter((loop) => loop.id !== id)
    if (loops.length === 0) {
      loopId += 1
      loops = [{ id: loopId, name: `LOOP ${String(loopId).padStart(2, '0')}`, length: 0, events: [] }]
    }
    if (!loops.some((loop) => loop.id === selectedLoopId)) selectedLoopId = loops[0].id
    renderLoops()
    setStatus(`${target.name} 녹음본을 삭제했어요`)
  }

  function toggleLoopPlayback(id: number): void {
    void audioContext.resume()
    if (loopPlaybacks.has(id)) {
      loopPlaybacks.delete(id)
      stopScheduledLoopVoices(id)
      setStatus('반복재생을 중지했어요')
    } else {
      const loop = loops.find((item) => item.id === id)
      if (!loop || loop.events.length === 0 || loop.length <= 0) return
      loopPlaybacks.set(id, { nextLoopAt: audioContext.currentTime + 0.045 })
      setStatus(`${loop.name} 반복재생 중`)
    }
    renderLoops()
  }

  function createNewLoop(): void {
    if (performanceRecording) return
    loopId += 1
    const loop: LoopTrack = { id: loopId, name: `LOOP ${String(loopId).padStart(2, '0')}`, length: 0, events: [] }
    loops = [...loops, loop]
    selectedLoopId = loop.id
    renderLoops()
    setStatus(`${loop.name} 준비 완료 · SPACE로 녹음을 시작하세요`)
  }

  newLoopButton.addEventListener('click', createNewLoop)

  function startPerformanceRecording(): void {
    if (samplingMode || samplingKey) {
      setStatus('마이크 샘플링을 먼저 완료해 주세요.', 'error')
      return
    }
    void audioContext.resume()
    const loop = selectedLoop()
    performanceRecording = true
    pendingEvents = []
    activeRecordedNotes.clear()
    baseLoopLength = loop.length
    performanceStartedAt = audioContext.currentTime + 0.055
    recordButton.classList.add('recording')
    recordingMeter.hidden = false
    if (loop.events.length && loop.length > 0) {
      stopScheduledLoopVoices(loop.id)
      loopPlaybacks.set(loop.id, { nextLoopAt: performanceStartedAt })
    }
    renderLoops()
    setStatus(`${loop.name} 녹음 중 · 패드 사운드가 레이어로 쌓입니다`, 'recording')
  }

  function stopPerformanceRecording(): void {
    if (!performanceRecording) return
    const loop = selectedLoop()
    const recordingEndedAt = audioContext.currentTime
    Array.from(activeRecordedNotes.keys()).forEach((voiceId) => finishRecordedNote(voiceId, recordingEndedAt))
    const duration = Math.max(0.5, audioContext.currentTime - performanceStartedAt)
    if (loop.length <= 0) loop.length = Math.round(duration * 10) / 10
    loop.events = [...loop.events, ...pendingEvents.map((event) => ({
      ...event,
      offset: event.offset % loop.length,
      duration: Math.min(event.duration, loop.length),
    }))]
      .sort((a, b) => a.offset - b.offset)
    performanceRecording = false
    pendingEvents = []
    recordButton.classList.remove('recording')
    recordingMeter.hidden = true
    if (loop.events.length > 0) {
      stopScheduledLoopVoices(loop.id)
      loopPlaybacks.set(loop.id, { nextLoopAt: audioContext.currentTime + 0.06 })
    }
    renderLoops()
    setStatus(`${loop.name} 저장 완료 · 재생하면서 다시 녹음해 레이어를 추가할 수 있어요`)
  }

  function togglePerformanceRecording(): void {
    if (performanceRecording) stopPerformanceRecording()
    else startPerformanceRecording()
  }

  recordButton.addEventListener('click', togglePerformanceRecording)

  function scheduleLoops(): void {
    if (!isActive()) {
      Array.from(scheduledLoopVoices.keys()).forEach((loopId) => stopScheduledLoopVoices(loopId))
      loopPlaybacks.forEach((playback) => { playback.nextLoopAt = audioContext.currentTime + 0.06 })
      return
    }
    const horizon = audioContext.currentTime + 0.12
    loopPlaybacks.forEach((playback, id) => {
      const loop = loops.find((item) => item.id === id)
      if (!loop || loop.length <= 0 || loop.events.length === 0) return
      while (playback.nextLoopAt < horizon) {
        loop.events.forEach((event) => playLoopEvent(id, event, playback.nextLoopAt + event.offset))
        playback.nextLoopAt += loop.length
      }
    })
    if (performanceRecording) {
      const recordedSeconds = Math.max(0, audioContext.currentTime - performanceStartedAt)
      const minutes = Math.floor(recordedSeconds / 60)
      const seconds = Math.floor(recordedSeconds % 60)
      const tenths = Math.floor((recordedSeconds % 1) * 10)
      recordingTimeElement.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`
    }
  }
  window.setInterval(scheduleLoops, 25)

  padElements.forEach((element, key) => {
    padPointers.set(key, new Set())
    element.addEventListener('contextmenu', (event) => event.preventDefault())
    element.addEventListener('pointerdown', (event) => {
      if (!isActive()) return
      event.preventDefault()
      element.setPointerCapture(event.pointerId)
      pointerKeys.set(event.pointerId, key)
      padPointers.get(key)!.add(event.pointerId)
      setPadPressed(key, true)
      const voiceId = `pointer-${event.pointerId}`
      beginLongPress(voiceId, key)
      handlePadPress(key, voiceId)
    })
    const release = (event: PointerEvent): void => {
      const voiceId = `pointer-${event.pointerId}`
      cancelLongPress(voiceId)
      handlePadRelease(voiceId)
      pointerKeys.delete(event.pointerId)
      padPointers.get(key)!.delete(event.pointerId)
      if (padPointers.get(key)!.size === 0 && !heldKeyboardKeys.has(key)) setPadPressed(key, false)
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    }
    element.addEventListener('pointerup', release)
    element.addEventListener('pointercancel', release)
  })

  const keyDownHandler = (event: KeyboardEvent): void => {
    if (!isActive()) return
    if (event.code === 'Space') {
      event.preventDefault()
      if (!event.repeat) togglePerformanceRecording()
      return
    }
    const key = event.key.toLowerCase() as PadKey
    if (!PAD_KEYS.includes(key)) return
    event.preventDefault()
    if (event.repeat || heldKeyboardKeys.has(key)) return
    heldKeyboardKeys.add(key)
    setPadPressed(key, true)
    const voiceId = `keyboard-${key}`
    beginLongPress(voiceId, key)
    handlePadPress(key, voiceId)
  }

  const keyUpHandler = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase() as PadKey
    if (!PAD_KEYS.includes(key)) return
    heldKeyboardKeys.delete(key)
    const voiceId = `keyboard-${key}`
    cancelLongPress(voiceId)
    handlePadRelease(voiceId)
    if ((padPointers.get(key)?.size ?? 0) === 0) setPadPressed(key, false)
  }

  window.addEventListener('keydown', keyDownHandler)
  window.addEventListener('keyup', keyUpHandler)
  window.addEventListener('blur', () => {
    Array.from(activeVoices.keys()).forEach((voiceId) => stopPadVoice(voiceId))
    heldKeyboardKeys.clear()
    pointerKeys.clear()
    padPointers.forEach((pointers) => pointers.clear())
    PAD_KEYS.forEach((key) => setPadPressed(key, false))
    longPressTimers.forEach((timer) => window.clearTimeout(timer))
    longPressTimers.clear()
  })

  function resize(): void {
    container.style.setProperty('--sampler-height', `${container.clientHeight}px`)
  }

  renderEditor()
  renderLoops()
  return { resize }
}
