import type { Color } from 'chess.js'
import { CARDS } from './tactics'
import type { CardId } from './tactics'

export type PlayMode = 'computer' | 'online'
export type LinkPhase = 'gathering' | 'wait-reply' | 'wait-host' | 'connecting' | 'open' | 'failed' | 'closed'

export type OfferMeta = {
  hostColor: Color
  timed: boolean
  gameId: string
}

export type PvpMessage =
  | { type: 'battle-start'; version: 2; gameId: string; hostColor: Color }
  | { type: 'battle-action'; version: 2; gameId: string; ply: number; from: string; to: string; promotion?: string; before: string }
  | { type: 'battle-resign'; version: 2; gameId: string; ply: number; color: Color }
  | { type: 'hello'; color: Color; timed: boolean; gameId: string }
  | { type: 'ready' }
  | { type: 'move'; from: string; to: string; promotion?: string; before?: string; roll?: number; fen?: string; pgn?: string; seconds?: { w: number; b: number }; command?: { w: number; b: number } }
  | { type: 'card'; card: CardId; targets: string[]; before?: string; command?: { w: number; b: number } }
  | { type: 'resign'; color: Color }
  | { type: 'timeout'; color: Color }
  | { type: 'draw'; accept?: boolean }
  | { type: 'undo'; accept?: boolean; pgn?: string; seconds?: { w: number; b: number } }

type Signal = {
  v: 1
  t: 'o' | 'a'
  s: string
  c?: Color
  m?: 0 | 1
  g?: string
}

const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
}

export function extractCode(input: string) {
  const text = input.trim()
  const marker = text.indexOf('#join/')
  if (marker >= 0) return decodeURIComponent(text.slice(marker + 6)).split(/[\s&]/)[0]
  const match = text.match(/cc1z?\.[A-Za-z0-9_-]+/)
  return match ? match[0] : text
}

export function inviteLink(code: string) {
  const url = new URL(location.href)
  url.hash = `join/${code}`
  return url.href
}

export async function encodeSignal(signal: Signal) {
  const json = JSON.stringify(signal)
  if (typeof CompressionStream === 'undefined') return `cc1z.${base64url(new TextEncoder().encode(json))}`
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return `cc1.${base64url(bytes)}`
}

export async function decodeSignal(input: string): Promise<Signal> {
  const code = extractCode(input)
  const compressed = code.startsWith('cc1.')
  const plain = code.startsWith('cc1z.')
  if (!compressed && !plain) throw new Error('This link is not valid.')
  const bytes = fromBase64url(code.slice(plain ? 5 : 4))
  const json = plain
    ? new TextDecoder().decode(bytes)
    : await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
  const signal = JSON.parse(json) as Signal
  if (signal.v !== 1 || (signal.t !== 'o' && signal.t !== 'a') || typeof signal.s !== 'string' || !signal.s.includes('v=0')) {
    throw new Error('This link is not valid.')
  }
  return signal
}

export function parseMessage(data: string): PvpMessage | null {
  try {
    const message = JSON.parse(data) as PvpMessage
    if (message.type === 'battle-start' || message.type === 'battle-action' || message.type === 'battle-resign') {
      if (message.version !== 2 || !isGameId(message.gameId)) return null
      if (message.type === 'battle-start') {
        return isColor(message.hostColor)
          ? { type: message.type, version: message.version, gameId: message.gameId, hostColor: message.hostColor }
          : null
      }
      if (!Number.isSafeInteger(message.ply) || message.ply < 0) return null
      if (message.type === 'battle-resign') {
        return isColor(message.color)
          ? { type: message.type, version: message.version, gameId: message.gameId, ply: message.ply, color: message.color }
          : null
      }
      if (!isSquare(message.from) || !isSquare(message.to) || !isPromotion(message.promotion)
        || typeof message.before !== 'string' || message.before.length >= 30000) return null
      return {
        type: message.type,
        version: message.version,
        gameId: message.gameId,
        ply: message.ply,
        from: message.from,
        to: message.to,
        ...(message.promotion === undefined ? {} : { promotion: message.promotion }),
        before: message.before,
      }
    }
    if (message.type === 'hello' && isColor(message.color) && typeof message.timed === 'boolean' && typeof message.gameId === 'string') return message
    if (message.type === 'ready') return message
    if (message.type === 'move' && isSquare(message.from) && isSquare(message.to) && isPromotion(message.promotion)
      && (message.before === undefined || typeof message.before === 'string')
      && isCommand(message.command)
      && (message.roll === undefined || (typeof message.roll === 'number' && Number.isFinite(message.roll) && message.roll >= 0 && message.roll < 1))) return message
    if (message.type === 'card' && isCard(message.card) && Array.isArray(message.targets)
      && message.targets.length > 0 && message.targets.length <= 2 && message.targets.every(isSquare)
      && (message.before === undefined || typeof message.before === 'string')
      && isCommand(message.command)) return message
    if ((message.type === 'resign' || message.type === 'timeout') && isColor(message.color)) return message
    if (message.type === 'draw' && (message.accept === undefined || typeof message.accept === 'boolean')) return message
    if (message.type === 'undo' && (message.accept === undefined || typeof message.accept === 'boolean')) return message
  } catch { return null }
  return null
}

export interface FriendLink {
  role: 'host' | 'guest'
  hostColor: Color
  timed: boolean
  gameId: string
  phase: LinkPhase
  send(message: PvpMessage): void
  close(): void
  onMessage(handler: (message: PvpMessage) => void): void
  onStatus(handler: (phase: LinkPhase) => void): void
}

export class PvpLink implements FriendLink {
  readonly pc = new RTCPeerConnection(ICE)
  role: 'host' | 'guest' = 'host'
  hostColor: Color = 'w'
  timed = true
  gameId = ''
  invite = ''
  reply = ''
  phase: LinkPhase = 'gathering'
  private channel: RTCDataChannel | null = null
  private queue: string[] = []
  private messageHandler: ((message: PvpMessage) => void) | null = null
  private statusHandler: ((phase: LinkPhase) => void) | null = null

  constructor() {
    const fail = () => {
      if (this.pc.connectionState === 'failed' || this.pc.iceConnectionState === 'failed') this.setPhase('failed')
    }
    this.pc.addEventListener('connectionstatechange', fail)
    this.pc.addEventListener('iceconnectionstatechange', fail)
  }

  beginConnect() {
    this.setPhase('connecting')
  }

  fail() {
    this.setPhase('failed')
  }

  onMessage(handler: (message: PvpMessage) => void) {
    this.messageHandler = handler
  }

  onStatus(handler: (phase: LinkPhase) => void) {
    this.statusHandler = handler
  }

  send(message: PvpMessage) {
    const data = JSON.stringify(message)
    if (this.channel?.readyState === 'open') this.channel.send(data)
    else this.queue.push(data)
  }

  close() {
    this.channel?.close()
    this.pc.close()
    this.phase = 'closed'
  }

  attach(channel: RTCDataChannel) {
    this.channel = channel
    channel.addEventListener('open', () => {
      this.setPhase('open')
      for (const item of this.queue) channel.send(item)
      this.queue = []
    })
    channel.addEventListener('message', (event) => {
      const message = parseMessage(String(event.data))
      if (message) this.messageHandler?.(message)
    })
    channel.addEventListener('close', () => {
      if (this.phase === 'open') this.setPhase('closed')
    })
  }

  private setPhase(phase: LinkPhase) {
    this.phase = phase
    this.statusHandler?.(phase)
  }
}

export async function createOffer(meta: OfferMeta) {
  const link = new PvpLink()
  link.role = 'host'
  link.hostColor = meta.hostColor
  link.timed = meta.timed
  link.gameId = meta.gameId
  link.attach(link.pc.createDataChannel('chess', { ordered: true }))
  const offer = await link.pc.createOffer()
  await link.pc.setLocalDescription(offer)
  await waitForIce(link.pc)
  link.invite = await encodeSignal({ v: 1, t: 'o', s: link.pc.localDescription?.sdp || offer.sdp || '', c: meta.hostColor, m: meta.timed ? 1 : 0, g: meta.gameId })
  link.phase = 'wait-reply'
  return link
}

export async function createAnswer(input: string) {
  const signal = await decodeSignal(input)
  if (signal.t !== 'o') throw new Error('This link is not valid.')
  const link = new PvpLink()
  link.role = 'guest'
  link.hostColor = signal.c === 'b' ? 'b' : 'w'
  link.timed = signal.m !== 0
  link.gameId = signal.g || ''
  link.pc.addEventListener('datachannel', (event) => link.attach(event.channel))
  await link.pc.setRemoteDescription({ type: 'offer', sdp: signal.s })
  const answer = await link.pc.createAnswer()
  await link.pc.setLocalDescription(answer)
  await waitForIce(link.pc)
  link.reply = await encodeSignal({ v: 1, t: 'a', s: link.pc.localDescription?.sdp || answer.sdp || '', g: link.gameId })
  link.phase = 'wait-host'
  return link
}

export async function acceptAnswer(link: PvpLink, input: string) {
  const signal = await decodeSignal(input)
  if (signal.t !== 'a') throw new Error('This reply is not valid.')
  if (signal.g && link.gameId && signal.g !== link.gameId) throw new Error('This reply is not valid.')
  link.beginConnect()
  try {
    await link.pc.setRemoteDescription({ type: 'answer', sdp: signal.s })
  } catch {
    link.fail()
    throw new Error('This reply is not valid.')
  }
}

function waitForIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = () => { if (pc.iceGatheringState === 'complete') done() }
    const timer = setTimeout(done, 2500)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

function isColor(value: unknown): value is Color {
  return value === 'w' || value === 'b'
}

function isGameId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isSquare(value: unknown) {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value)
}

function isPromotion(value: unknown) {
  return value === undefined || value === 'q' || value === 'r' || value === 'b' || value === 'n'
}

function isCard(value: unknown): value is CardId {
  return typeof value === 'string' && value in CARDS
}

function isCommand(value: unknown) {
  if (value === undefined) return true
  if (typeof value !== 'object' || value === null) return false
  const command = value as { w?: unknown; b?: unknown }
  return [command.w, command.b].every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 10)
}

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64url(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
