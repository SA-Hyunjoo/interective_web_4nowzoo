interface CaptureProvider {
  audioStream?: () => MediaStream | null
  isAvailable: () => boolean
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void
}

export interface CaptureController {
  dispose: () => void
}

const captureProviders: CaptureProvider[] = []

function availableProvider(): CaptureProvider | null {
  for (let index = captureProviders.length - 1; index >= 0; index -= 1) {
    if (captureProviders[index].isAvailable()) return captureProviders[index]
  }
  return null
}

export function registerCaptureProvider(provider: CaptureProvider): () => void {
  captureProviders.push(provider)
  return () => {
    const index = captureProviders.indexOf(provider)
    if (index >= 0) captureProviders.splice(index, 1)
  }
}

function fileName(extension: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -1)
  return `playroom-${stamp}.${extension}`
}

function supportedVideoMimeType(): string | undefined {
  const types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return types.find((type) => MediaRecorder.isTypeSupported(type))
}

interface ArchivedCapture {
  database?: string
  id: string
  kind: 'photo' | 'video'
  mime: string
  createdAt: number
  blob: Blob
}

const ARCHIVE_DB = 'playroom-webcam-captures'

function archiveDatabase(name = ARCHIVE_DB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('captures')) request.result.createObjectStore('captures', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function archiveCapture(capture: ArchivedCapture): Promise<void> {
  const database = await archiveDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('captures', 'readwrite')
    transaction.objectStore('captures').put(capture)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

async function archivedCaptures(name = ARCHIVE_DB): Promise<ArchivedCapture[]> {
  const database = await archiveDatabase(name)
  const captures = await new Promise<ArchivedCapture[]>((resolve, reject) => {
    const request = database.transaction('captures', 'readonly').objectStore('captures').getAll()
    request.onsuccess = () => resolve(request.result as ArchivedCapture[])
    request.onerror = () => reject(request.error)
  })
  database.close()
  return captures.map(capture => ({ ...capture, database: name })).sort((first, second) => second.createdAt - first.createdAt)
}

async function deleteArchivedCapture(id: string, name = ARCHIVE_DB): Promise<void> {
  const database = await archiveDatabase(name)
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('captures', 'readwrite')
    transaction.objectStore('captures').delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

async function saveBlob(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'PLAYROOM capture' })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 15_000)
}

function getCaptureSize(): { width: number; height: number } {
  const view = document.querySelector<HTMLElement>('.game-view:not([hidden])')
  const aspect = (view?.clientWidth || window.innerWidth) / Math.max(1, view?.clientHeight || window.innerHeight)
  const width = Math.min(1280, Math.max(640, Math.round(window.innerWidth)))
  return { width, height: Math.round(width / aspect) }
}

export function setupCaptureController(root: HTMLElement): CaptureController {
  const button = document.querySelector<HTMLButtonElement>('#globalCaptureButton')!
  const videoButton = document.querySelector<HTMLButtonElement>('#globalVideoButton')!
  const archiveButton = document.querySelector<HTMLButtonElement>('#globalArchiveButton')!
  const archiveCount = document.querySelector<HTMLElement>('#globalArchiveCount')!
  const gallery = document.querySelector<HTMLElement>('#globalCaptureGallery')!
  const galleryList = document.querySelector<HTMLElement>('#globalGalleryList')!
  const galleryClose = document.querySelector<HTMLButtonElement>('#globalGalleryClose')!
  const status = document.querySelector<HTMLElement>('#globalCaptureStatus')!
  const captureCanvas = document.createElement('canvas')
  const captureContext = captureCanvas.getContext('2d', { alpha: false })!
  let longPressTimer: number | null = null
  let longPressStarted = false
  let recording = false
  let renderBusy = false
  let recorder: MediaRecorder | null = null
  let recorderStream: MediaStream | null = null
  let chunks: Blob[] = []
  let recordFrame = 0
  let nextRenderAt = 0
  let galleryUrls: string[] = []
  let finishing = false
  let recordingView: HTMLElement | null = null

  function setStatus(message: string): void {
    status.textContent = message
    status.hidden = false
    window.setTimeout(() => {
      if (!recording) status.hidden = true
    }, 2200)
  }

  async function refreshGallery(): Promise<void> {
    try {
      const captures = (await Promise.all([archivedCaptures(), archivedCaptures('playroom-balloon-captures')])).flat().sort((a, b) => b.createdAt - a.createdAt)
      archiveCount.textContent = String(captures.length)
      galleryUrls.forEach((url) => URL.revokeObjectURL(url))
      galleryUrls = []
      galleryList.replaceChildren()
      if (captures.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'global-gallery-empty'
        empty.textContent = '아직 보관한 사진과 영상이 없어요.'
        galleryList.append(empty)
        return
      }
      captures.forEach((capture) => {
        const card = document.createElement('article')
        card.className = 'global-capture-card'
        const url = URL.createObjectURL(capture.blob)
        galleryUrls.push(url)
        if (capture.kind === 'photo') {
          const image = document.createElement('img')
          image.src = url
          image.alt = '저장한 사진'
          image.tabIndex = 0
          image.setAttribute('role', 'button')
          image.setAttribute('aria-label', '사진 확대 보기')
          const preview = () => {
            const dialog = document.createElement('dialog')
            dialog.className = 'capture-preview'
            const full = document.createElement('img')
            full.src = url; full.alt = '촬영 사진 확대'
            const close = document.createElement('button')
            close.textContent = '닫기'
            close.addEventListener('click', () => dialog.close())
            dialog.append(full, close)
            dialog.addEventListener('close', () => dialog.remove(), { once: true })
            document.body.append(dialog); dialog.showModal()
          }
          image.addEventListener('click', preview)
          image.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); preview() }
          })
          card.append(image)
        } else {
          const clip = document.createElement('video')
          clip.src = url
          clip.controls = true
          clip.muted = true
          clip.playsInline = true
          clip.preload = 'metadata'
          card.append(clip)
          const expand = document.createElement('button')
          expand.textContent = '확대 재생'
          expand.addEventListener('click', () => {
            clip.pause()
            const dialog = document.createElement('dialog')
            dialog.className = 'capture-preview'
            const full = document.createElement('video')
            full.src = url; full.controls = true; full.playsInline = true
            const close = document.createElement('button')
            close.textContent = '닫기'
            close.addEventListener('click', () => dialog.close())
            dialog.addEventListener('close', () => { full.pause(); full.removeAttribute('src'); full.load(); dialog.remove() }, { once: true })
            dialog.append(full, close)
            document.body.append(dialog); dialog.showModal()
          })
          card.append(expand)
        }
        const meta = document.createElement('div')
        meta.className = 'global-capture-meta'
        const label = document.createElement('span')
        label.textContent = `${capture.kind === 'photo' ? 'PHOTO' : capture.mime.includes('mp4') ? 'MP4' : 'WEBM'} · ${new Date(capture.createdAt).toLocaleDateString('ko-KR')}`
        const download = document.createElement('a')
        download.href = url
        download.download = `${fileName(capture.kind === 'photo' ? 'jpg' : capture.mime.includes('mp4') ? 'mp4' : 'webm')}`
        download.textContent = '↓'
        download.setAttribute('aria-label', '파일 저장')
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.textContent = '×'
        remove.setAttribute('aria-label', '보관함에서 삭제')
        remove.addEventListener('click', async () => {
          try {
            await deleteArchivedCapture(capture.id, capture.database)
            await refreshGallery()
          } catch { setStatus('삭제하지 못했어요. 다시 시도해 주세요') }
        })
        meta.append(label, download, remove)
        card.append(meta)
        galleryList.append(card)
      })
    } catch {
      setStatus('보관함을 열 수 없어요')
    }
  }

  async function renderFrame(): Promise<void> {
    // MediaRecorder dimensions stay constant even if the device rotates.
    const { width, height } = recording ? captureCanvas : getCaptureSize()
    if (captureCanvas.width !== width || captureCanvas.height !== height) {
      captureCanvas.width = width
      captureCanvas.height = height
    }
    const provider = availableProvider()
    if (provider) {
      provider.draw(captureContext, width, height)
      return
    }
    const { default: html2canvas } = await import('html2canvas')
    button.classList.add('capture-hidden')
    try {
      const snapshot = await html2canvas(root.querySelector<HTMLElement>('.game-view:not([hidden])') ?? root, {
        backgroundColor: '#17151c',
        scale: Math.min(1, width / Math.max(1, root.clientWidth)),
        logging: false,
        useCORS: true,
        imageTimeout: 0,
      })
      captureContext.fillStyle = '#17151c'
      captureContext.fillRect(0, 0, width, height)
      const scale = Math.min(width / snapshot.width, height / snapshot.height)
      const drawWidth = snapshot.width * scale
      const drawHeight = snapshot.height * scale
      captureContext.drawImage(snapshot, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
    } finally {
      button.classList.remove('capture-hidden')
    }
  }

  async function takePhoto(): Promise<void> {
    if (recording || renderBusy || finishing) return
    renderBusy = true
    setStatus('사진을 저장하고 있어요…')
    try {
      await renderFrame()
      const blob = await new Promise<Blob | null>((resolve) => captureCanvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('photo-encode-failed')
      await archiveCapture({ id: crypto.randomUUID(), kind: 'photo', mime: 'image/jpeg', createdAt: Date.now(), blob })
      await refreshGallery()
      await saveBlob(blob, fileName('jpg'))
      setStatus('사진을 보관함에 저장했어요')
    } catch {
      setStatus('사진을 저장하지 못했어요')
    } finally {
      renderBusy = false
    }
  }

  async function captureLoop(): Promise<void> {
    if (!recording) return
    if (document.hidden || recordingView?.hidden) { stopRecording(); return }
    const now = performance.now()
    if (!renderBusy && now >= nextRenderAt) {
      renderBusy = true
      nextRenderAt = now + 83
      try {
        await renderFrame()
      } catch {
        setStatus('영상 프레임을 기록하지 못했어요')
      } finally {
        renderBusy = false
      }
    }
    recordFrame = requestAnimationFrame(() => void captureLoop())
  }

  async function startRecording(): Promise<void> {
    if (renderBusy || finishing || recording) return
    if (recording || !('MediaRecorder' in window) || !captureCanvas.captureStream) {
      setStatus('이 브라우저에서는 영상 녹화를 지원하지 않아요')
      return
    }
    renderBusy = true
    try {
      await renderFrame()
      recorderStream = captureCanvas.captureStream(12)
      availableProvider()?.audioStream?.()?.getAudioTracks().forEach(track => recorderStream!.addTrack(track.clone()))
      const mimeType = supportedVideoMimeType()
      recorder = new MediaRecorder(recorderStream, mimeType ? { mimeType, videoBitsPerSecond: 1_800_000 } : undefined)
      chunks = []
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      })
      recorder.addEventListener('stop', async () => {
        const type = recorder?.mimeType || mimeType || 'video/webm'
        const extension = type.includes('mp4') ? 'mp4' : 'webm'
        const blob = new Blob(chunks, { type })
        recorderStream?.getTracks().forEach((track) => track.stop())
        recorderStream = null
        recorder = null
        chunks = []
        button.classList.remove('recording')
        videoButton.classList.remove('recording')
        videoButton.innerHTML = '<i aria-hidden="true"></i> VIDEO'
        status.hidden = true
        try {
          await archiveCapture({ id: crypto.randomUUID(), kind: 'video', mime: type, createdAt: Date.now(), blob })
          await refreshGallery()
          await saveBlob(blob, fileName(extension))
          setStatus(`${extension.toUpperCase()} 영상을 보관함에 저장했어요`)
        } catch {
          setStatus('동영상을 저장하지 못했어요')
        } finally { finishing = false }
      }, { once: true })
      recorder.start(1000)
      recording = true
      recordingView = root.querySelector<HTMLElement>('.game-view:not([hidden])')
      button.classList.add('recording')
      videoButton.classList.add('recording')
      videoButton.innerHTML = '<i aria-hidden="true"></i> STOP'
      setStatus('● 동영상 녹화 중 · STOP을 누르면 저장')
      nextRenderAt = performance.now()
      void captureLoop()
    } catch {
      recorderStream?.getTracks().forEach((track) => track.stop())
      recorderStream = null
      recorder = null
      setStatus('동영상 녹화를 시작하지 못했어요')
    } finally {
      renderBusy = false
    }
  }

  function stopRecording(): void {
    if (!recording) return
    recording = false
    recordingView = null
    finishing = true
    if (recordFrame) cancelAnimationFrame(recordFrame)
    recorder?.stop()
    button.classList.remove('recording')
    videoButton.classList.remove('recording')
    setStatus('동영상을 정리하고 있어요…')
  }

  function clearLongPress(): void {
    if (longPressTimer !== null) window.clearTimeout(longPressTimer)
    longPressTimer = null
  }

  function pointerDown(event: PointerEvent): void {
    event.preventDefault()
    if (recording) {
      longPressStarted = true
      stopRecording()
      return
    }
    longPressStarted = false
    button.setPointerCapture(event.pointerId)
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null
      longPressStarted = true
      void startRecording()
    }, 460)
  }

  function pointerUp(event: PointerEvent): void {
    const wasLongPress = longPressStarted
    clearLongPress()
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId)
    if (!wasLongPress && !recording) void takePhoto()
  }

  function pointerCancel(event: PointerEvent): void {
    clearLongPress()
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId)
  }

  function videoClick(): void {
    if (recording) stopRecording()
    else void startRecording()
  }

  function archiveClick(): void {
    gallery.hidden = !gallery.hidden
    archiveButton.setAttribute('aria-expanded', String(!gallery.hidden))
    if (!gallery.hidden) void refreshGallery()
  }

  function closeGallery(): void {
    gallery.hidden = true
    archiveButton.setAttribute('aria-expanded', 'false')
  }

  button.addEventListener('pointerdown', pointerDown)
  button.addEventListener('pointerup', pointerUp)
  button.addEventListener('pointercancel', pointerCancel)
  videoButton.addEventListener('click', videoClick)
  archiveButton.addEventListener('click', archiveClick)
  galleryClose.addEventListener('click', closeGallery)
  const pauseRecording = () => { if (document.hidden) stopRecording() }
  document.addEventListener('visibilitychange', pauseRecording)
  void refreshGallery()

  return {
    dispose: () => {
      clearLongPress()
      if (recordFrame) cancelAnimationFrame(recordFrame)
      stopRecording()
      button.removeEventListener('pointerdown', pointerDown)
      button.removeEventListener('pointerup', pointerUp)
      button.removeEventListener('pointercancel', pointerCancel)
      videoButton.removeEventListener('click', videoClick)
      archiveButton.removeEventListener('click', archiveClick)
      galleryClose.removeEventListener('click', closeGallery)
      document.removeEventListener('visibilitychange', pauseRecording)
      galleryUrls.forEach((url) => URL.revokeObjectURL(url))
    },
  }
}
