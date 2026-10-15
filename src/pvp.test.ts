import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { resolveMove } from './capture'
import { decodeSignal, encodeSignal, extractCode, parseMessage } from './pvp'

const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\n'

describe('friend link codes', () => {
  it('keeps an invite and a reply intact', async () => {
    const invite = await encodeSignal({ v: 1, t: 'o', s: sdp, c: 'b', m: 0, g: 'game-1' })
    const reply = await encodeSignal({ v: 1, t: 'a', s: sdp, g: 'game-1' })
    expect(invite.startsWith('cc1')).toBe(true)
    expect(await decodeSignal(invite)).toMatchObject({ t: 'o', c: 'b', m: 0, g: 'game-1', s: sdp })
    expect(await decodeSignal(`https://player.github.io/chess/#join/${invite}`)).toMatchObject({ t: 'o', g: 'game-1' })
    expect(await decodeSignal(reply)).toMatchObject({ t: 'a', s: sdp })
  })

  it('reads a code from a shared link and rejects a bad code', async () => {
    const invite = await encodeSignal({ v: 1, t: 'o', s: sdp, c: 'w', m: 1, g: 'game-2' })
    expect(extractCode(`Please open ${inviteLinkSafe(invite)} thanks`)).toBe(invite)
    await expect(decodeSignal('not-a-link')).rejects.toThrow('This link is not valid.')
  })
})

describe('friend messages', () => {
  it('accepts legal game messages and rejects bad data', () => {
    expect(parseMessage(JSON.stringify({ type: 'move', from: 'e2', to: 'e4' }))).toMatchObject({ from: 'e2', to: 'e4' })
    expect(parseMessage(JSON.stringify({ type: 'move', from: 'e2', to: 'e9' }))).toBeNull()
    expect(parseMessage(JSON.stringify({ type: 'resign', color: 'w' }))?.type).toBe('resign')
    expect(parseMessage(JSON.stringify({ type: 'draw', accept: false }))).toMatchObject({ accept: false })
    expect(parseMessage('{"type":"hack"}')).toBeNull()
    expect(parseMessage('nope')).toBeNull()
  })

  it('accepts one shared capture roll and rejects invalid rolls', () => {
    const move = { type: 'move', from: 'e4', to: 'd5', before: 'position' }
    for (const roll of [0, 0.7, 0.999999]) {
      expect(parseMessage(JSON.stringify({ ...move, roll }))).toMatchObject({ roll })
    }
    for (const roll of [-0.1, 1, '0.5', null]) {
      expect(parseMessage(JSON.stringify({ ...move, roll }))).toBeNull()
    }
    expect(parseMessage(JSON.stringify({ ...move, before: 4 }))).toBeNull()
  })
})

describe('shared capture outcomes', () => {
  it.each([0, 0.999999])('keeps both players in the same position with roll %s', roll => {
    const sender = new Chess('7k/8/8/4p3/3P4/8/8/K7 w - - 0 1')
    const receiver = new Chess(sender.fen())
    const before = sender.fen()
    const input = { from: 'd4', to: 'e5' }
    const local = resolveMove(sender, input, roll)
    const message = parseMessage(JSON.stringify({ type: 'move', ...input, before, roll: local.capture?.roll }))
    expect(message?.type).toBe('move')
    if (message?.type !== 'move') throw new Error('Expected a move message')
    expect(message.before).toBe(receiver.fen())
    const remote = resolveMove(receiver, message, message.roll)
    expect(remote.capture).toEqual(local.capture)
    expect(receiver.fen()).toBe(sender.fen())
    expect(receiver.pgn()).toBe(sender.pgn())
  })
})

function inviteLinkSafe(code: string) {
  return `https://player.github.io/chess/#join/${code}`
}
