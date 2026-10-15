import { describe, expect, it } from 'vitest'
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
})

function inviteLinkSafe(code: string) {
  return `https://player.github.io/chess/#join/${code}`
}
