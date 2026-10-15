import type { Color } from 'chess.js'
import { parseMessage } from './pvp'
import type { FriendLink, LinkPhase, OfferMeta, PvpMessage } from './pvp'

const APP_ID = 'chess-club-friends-v1'
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODE_LENGTH = 8
const RELAY_CHECK_MS = 12_000

type MessageAction = {
  send: (data: string, options?: { target?: string }) => Promise<void>
  onMessage: ((data: string, context: { peerId: string }) => void) | null
}

type RelayRoom = {
  makeAction: (namespace: string) => unknown
  leave: () => Promise<void>
  onPeerJoin: ((peerId: string) => void) | null
  onPeerLeave: ((peerId: string) => void) | null
}

export function makeRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  return Array.from(bytes, byte => ALPHABET[byte % ALPHABET.length]).join('')
}

export function normalizeRoomCode(input: string) {
  const text = input.trim()
  const marker = text.indexOf('#play/')
  const raw = marker >= 0 ? text.slice(marker + 6) : text
  const code = raw.toUpperCase().replace(/[\s-]/g, '')
  if (code.length !== CODE_LENGTH) return null
  for (const char of code) if (!ALPHABET.includes(char)) return null
  return code
}

export function formatRoomCode(code: string) {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

export function playLink(code: string) {
  const url = new URL(location.href)
  url.hash = `play/${code}`
  return url.href
}

export class RelayLink implements FriendLink {
  role: 'host' | 'guest'
  hostColor: Color = 'w'
  timed = true
  gameId = ''
  phase: LinkPhase
  readonly code: string
  private room: RelayRoom | null = null
  private action: MessageAction | null = null
  private peer: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private messageHandler: ((message: PvpMessage) => void) | null = null
  private statusHandler: ((phase: LinkPhase) => void) | null = null

  constructor(code: string, role: 'host' | 'guest', meta?: OfferMeta) {
    this.code = code
    this.role = role
    this.phase = role === 'host' ? 'wait-reply' : 'wait-host'
    if (meta) {
      this.hostColor = meta.hostColor
      this.timed = meta.timed
      this.gameId = meta.gameId
    }
  }

  async start() {
    const { joinRoom, getRelaySockets } = await import('trystero/nostr')
    if (this.phase === 'closed') return
    const room = joinRoom({ appId: APP_ID, password: this.code, relayConfig: { warnOnRelayFailure: false } }, this.code) as unknown as RelayRoom
    const action = room.makeAction('chess') as MessageAction
    this.room = room
    this.action = action
    action.onMessage = (data, { peerId }) => this.receive(String(data), peerId)
    room.onPeerJoin = peerId => {
      if (this.role === 'host' && !this.peer) {
        void action.send(JSON.stringify({ type: 'hello', color: this.hostColor, timed: this.timed, gameId: this.gameId } satisfies PvpMessage), { target: peerId })
      }
    }
    room.onPeerLeave = peerId => {
      if (peerId === this.peer && this.phase === 'open') this.setPhase('closed')
    }
    this.timer = setTimeout(() => {
      if (this.phase !== 'wait-reply' && this.phase !== 'wait-host') return
      const sockets = Object.values(getRelaySockets() as Record<string, WebSocket>)
      if (!sockets.some(socket => socket.readyState === WebSocket.OPEN)) this.setPhase('failed')
    }, RELAY_CHECK_MS)
  }

  onMessage(handler: (message: PvpMessage) => void) {
    this.messageHandler = handler
  }

  fail() {
    this.setPhase('failed')
  }

  onStatus(handler: (phase: LinkPhase) => void) {
    this.statusHandler = handler
  }

  send(message: PvpMessage) {
    if (this.peer && this.action) void this.action.send(JSON.stringify(message), { target: this.peer })
  }

  close() {
    if (this.timer) clearTimeout(this.timer)
    this.phase = 'closed'
    void this.room?.leave()
    this.room = null
  }

  private receive(data: string, peerId: string) {
    const message = parseMessage(data)
    if (!message) return
    if (!this.peer) {
      if (this.role === 'host' && message.type === 'ready') {
        this.peer = peerId
        this.setPhase('open')
      }
      if (this.role === 'guest' && message.type === 'hello') {
        this.hostColor = message.color
        this.timed = message.timed
        this.gameId = message.gameId
        this.peer = peerId
        void this.action?.send(JSON.stringify({ type: 'ready' } satisfies PvpMessage), { target: peerId })
        this.setPhase('open')
      }
      return
    }
    if (peerId === this.peer && message.type !== 'hello' && message.type !== 'ready') this.messageHandler?.(message)
  }

  private setPhase(phase: LinkPhase) {
    if (this.phase === 'closed') return
    this.phase = phase
    if (phase === 'open' && this.timer) clearTimeout(this.timer)
    this.statusHandler?.(phase)
  }
}

export async function openRelay(code: string, role: 'host' | 'guest', meta?: OfferMeta) {
  const link = new RelayLink(code, role, meta)
  await link.start()
  return link
}
