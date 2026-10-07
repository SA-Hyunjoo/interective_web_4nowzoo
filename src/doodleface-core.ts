// Coordinates are mirrored, half-camera local. Metric geometry uses camera height units.
export interface Point { x: number; y: number }
export type Player = 0 | 1
export const COLORS = ['#25242b', '#ffffff', '#ff5263', '#ff963e', '#ffd447', '#71ce71', '#36c5c9', '#5689ef', '#aa78df', '#f391c0']
export const TIMING = { stable: 650, countdown: 5000, swap: 850, play: 60000, notice: 2400, result: 12400, handHold: 220, release: 110 } as const
export const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109]
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
export function playerFor(points: Point[]): Player {
  return 1 - points.reduce((sum, p) => sum + p.x, 0) / points.length < .5 ? 0 : 1
}
export function localPoint(p: Point, player: Player): Point { return { x: (1 - p.x) * 2 - player, y: p.y } }
export function coverTransform(width: number, height: number, cameraWidth: number, cameraHeight: number) {
  const scale = Math.max(width / (cameraWidth / 2), height / cameraHeight)
  const w = cameraWidth / 2 * scale, h = cameraHeight * scale
  return { w, h, x: (width - w) / 2, y: (height - h) / 2 }
}
export type Cover = ReturnType<typeof coverTransform>
export const toPanel = (p: Point, t: Cover): Point => ({ x: t.x + p.x * t.w, y: t.y + p.y * t.h })
export const fromPanel = (p: Point, t: Cover): Point => ({ x: (p.x - t.x) / t.w, y: (p.y - t.y) / t.h })
export interface Pose { points: Point[]; at: number; scale: number; angle: number; aspect: number }
export function makePose(points: Point[], at: number, aspect: number): Pose {
  const a = points[454], b = points[234]
  return { points, at, aspect, scale: Math.max(.001, Math.hypot((b.x - a.x) * aspect, b.y - a.y)), angle: Math.atan2(b.y - a.y, (b.x - a.x) * aspect) }
}
export function predictPose(current: Pose, previous: Pose | null, now: number): Pose {
  if (!previous || current.at <= previous.at || current.at - previous.at > 350) return current
  const ratio = clamp((now - current.at) / (current.at - previous.at), 0, .7)
  const horizon = Math.min(1, 70 / Math.max(1, now - current.at))
  return makePose(current.points.map((p, i) => ({
    x: p.x + clamp(p.x - previous.points[i].x, -.035, .035) * ratio * horizon,
    y: p.y + clamp(p.y - previous.points[i].y, -.035, .035) * ratio * horizon,
  })), current.at, current.aspect)
}
export interface Anchor { landmark: number; dx: number; dy: number }
export function anchorPoint(point: Point, pose: Pose): Anchor {
  let landmark = 0, best = Infinity
  pose.points.forEach((p, i) => {
    const d = ((p.x - point.x) * pose.aspect) ** 2 + (p.y - point.y) ** 2
    if (d < best) { best = d; landmark = i }
  })
  const origin = pose.points[landmark], dx = (point.x - origin.x) * pose.aspect, dy = point.y - origin.y
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle)
  return { landmark, dx: (c * dx + s * dy) / pose.scale, dy: (-s * dx + c * dy) / pose.scale }
}
export function resolveAnchor(anchor: Anchor, pose: Pose): Point {
  const origin = pose.points[anchor.landmark], c = Math.cos(pose.angle), s = Math.sin(pose.angle)
  return { x: origin.x + (c * anchor.dx - s * anchor.dy) * pose.scale / pose.aspect, y: origin.y + (s * anchor.dx + c * anchor.dy) * pose.scale }
}
export function insideFace(point: Point, pose: Pose): boolean {
  let inside = false
  for (let i = 0, j = FACE_OVAL.length - 1; i < FACE_OVAL.length; j = i++) {
    const a = pose.points[FACE_OVAL[i]], b = pose.points[FACE_OVAL[j]]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
export class Pinch {
  down = false
  point: Point | null = null
  seenAt = -Infinity
  private releaseAt: number | null = null
  update(point: Point | null, ratio: number, now: number): { started: boolean; ended: boolean } {
    const before = this.down
    if (point) {
      this.point = point; this.seenAt = now
      if (!this.down && ratio < .48) { this.down = true; this.releaseAt = null }
      else if (this.down && ratio > .67) {
        this.releaseAt ??= now
        if (now - this.releaseAt >= TIMING.release) { this.down = false; this.releaseAt = null }
      } else this.releaseAt = null
    } else if (now - this.seenAt > TIMING.handHold) {
      this.down = false; this.point = null; this.releaseAt = null
    } else {
      // Missing observations cannot confirm a sustained release.
      this.releaseAt = null
    }
    return { started: !before && this.down, ended: before && !this.down }
  }
}
export type Phase = 'lobby' | 'loading' | 'waiting' | 'countdown' | 'swapping' | 'playing' | 'result'
export class Round {
  phase: Phase = 'lobby'
  since = 0
  private stableSince: number | null = null
  tick(now: number, bothFaces: boolean) {
    if (this.phase === 'waiting') {
      if (!bothFaces) this.stableSince = null
      else this.stableSince ??= now
      if (this.stableSince !== null && now - this.stableSince >= TIMING.stable) this.enter('countdown', now)
    } else if (this.phase === 'countdown') {
      if (!bothFaces) this.enter('waiting', now)
      else if (now - this.since >= TIMING.countdown) this.enter('swapping', now)
    } else if (this.phase === 'playing' && now - this.since >= TIMING.play) this.enter('result', this.since + TIMING.play)
    else if (this.phase === 'result' && now - this.since >= TIMING.result) this.enter('lobby', now)
  }
  enter(phase: Phase, now: number) { this.phase = phase; this.since = now; this.stableSince = null }
  finishSwap(now: number) { if (this.phase === 'swapping') this.enter('playing', now) }
  seconds(now: number) { return Math.max(0, Math.ceil(((this.phase === 'countdown' ? TIMING.countdown : TIMING.play) - (now - this.since)) / 1000)) }
}
export interface Stroke { color: string; points: Anchor[] }
export class Drawing {
  strokes: Stroke[] = []
  active: Stroke | null = null
  start(point: Point, pose: Pose | null, color: string) {
    this.active = null
    if (pose && insideFace(point, pose)) { this.active = { color, points: [anchorPoint(point, pose)] }; this.strokes.push(this.active) }
  }
  append(point: Point, pose: Pose | null) { if (this.active && pose) this.active.points.push(anchorPoint(point, pose)) }
  end() { this.active = null }
}
