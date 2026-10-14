import { Chess } from 'chess.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getComputerMove } from './engine'
import type { ComputerMove } from './engine'
import type { EngineRequest, EngineResponse } from './engine.worker'

const levels = [1, 2, 3, 4]

function legalMove(fen: string, level: number): ComputerMove {
  const game = new Chess(fen)
  const move = getComputerMove(fen, level)
  expect(move).not.toBeNull()
  if (!move) throw new Error('Expected a legal move')

  const legalMoves = game.moves({ verbose: true }).map((candidate) => (
    candidate.promotion
      ? { from: candidate.from, to: candidate.to, promotion: candidate.promotion }
      : { from: candidate.from, to: candidate.to }
  ))
  expect(legalMoves).toContainEqual(move)
  expect(() => game.move(move)).not.toThrow()
  return move
}

async function createWorker() {
  vi.resetModules()
  const worker = {
    onmessage: null as ((event: MessageEvent<EngineRequest>) => void) | null,
    postMessage: vi.fn<(response: EngineResponse) => void>(),
  }
  vi.stubGlobal('self', worker)
  await import('./engine.worker')
  return worker
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('getComputerMove', () => {
  it.each(levels)('returns a legal initial move at level %i', (level) => {
    const game = new Chess()
    const move = legalMove(game.fen(), level)
    expect(game.move(move).color).toBe('w')
    expect(move).not.toHaveProperty('promotion')
  })

  it.each(levels)('returns a legal black reply after e4 at level %i', (level) => {
    const game = new Chess()
    game.move('e4')
    const move = legalMove(game.fen(), level)
    expect(game.move(move).color).toBe('b')
    expect(game.turn()).toBe('w')
  })

  it.each(levels)('returns null for checkmate at level %i', (level) => {
    const game = new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1')
    expect(game.isCheckmate()).toBe(true)
    expect(getComputerMove(game.fen(), level)).toBeNull()
  })

  it.each([
    '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
    '7k/8/6K1/8/8/8/8/8 w - - 0 1',
    '7k/8/6K1/8/8/8/8/R7 w - - 100 80',
  ])('returns null for a drawn position: %s', (fen) => {
    expect(new Chess(fen).isDraw()).toBe(true)
    expect(getComputerMove(fen, 4)).toBeNull()
  })

  describe.each([3, 4])('mate preference at level %i', (level) => {
    it.each([
      '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
      '8/8/8/8/8/6k1/5q2/7K b - - 0 1',
    ])('selects mate in one: %s', (fen) => {
      const game = new Chess(fen)
      const move = legalMove(fen, level)
      game.move(move)
      expect(game.isCheckmate()).toBe(true)
    })
  })

  describe.each(levels)('promotions at level %i', (level) => {
    it.each([
      { fen: '7k/P7/8/8/8/8/8/4K3 w - - 0 1', from: 'a7', to: 'a8' },
      { fen: '4k3/8/8/8/8/8/p7/7K b - - 0 1', from: 'a2', to: 'a1' },
    ])('includes a legal promotion from $from', ({ fen, from, to }) => {
      expect(legalMove(fen, level)).toEqual({ from, to, promotion: 'q' })
    })
  })

  it('uses an underpromotion instead of immediate stalemate', () => {
    const fen = '8/k1P5/2K5/8/8/8/8/8 w - - 0 1'
    const queenPromotion = new Chess(fen)
    queenPromotion.move({ from: 'c7', to: 'c8', promotion: 'q' })
    expect(queenPromotion.isStalemate()).toBe(true)
    expect(legalMove(fen, 1)).toEqual({ from: 'c7', to: 'c8', promotion: 'r' })
  })

  it('returns the only legal move while in check', () => {
    const fen = '7k/6Q1/8/5K2/8/8/8/8 b - - 0 1'
    const game = new Chess(fen)
    expect(game.isCheck()).toBe(true)
    expect(game.moves()).toHaveLength(1)
    expect(legalMove(fen, 4)).toEqual({ from: 'h8', to: 'g7' })
  })

  it.each([
    ['e4', 'a6', 'e5', 'd5'],
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'],
  ])('preserves the supplied position after %j', (...moves) => {
    const game = new Chess()
    for (const move of moves) game.move(move)
    const fen = game.fen()
    const history = game.history()
    const board = game.board()
    const rights = game.getCastlingRights(game.turn())
    const choices = game.moves()

    const result = legalMove(fen, 3)

    expect(game.fen()).toBe(fen)
    expect(game.history()).toEqual(history)
    expect(game.board()).toEqual(board)
    expect(game.getCastlingRights(game.turn())).toEqual(rights)
    expect(game.moves()).toEqual(choices)
    expect(() => game.move(result)).not.toThrow()
  })

  it('uses the supplied en passant target', () => {
    const fen = '7k/8/8/3pP3/8/8/8/4K3 w - d6 0 1'
    const move = legalMove(fen, 1)
    expect(move).toEqual({ from: 'e5', to: 'd6' })
    const game = new Chess(fen)
    expect(game.move(move).isEnPassant()).toBe(true)
    expect(game.get('d5')).toBeUndefined()
  })

  it('returns a legal fallback when the search reaches its time limit', () => {
    let elapsed = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      elapsed += 1000
      return elapsed
    })
    legalMove(new Chess().fen(), 4)
  })

  it.each([0, 5, 2.5, NaN, Infinity])('handles an out-of-range level: %s', (level) => {
    legalMove('7k/6Q1/8/5K2/8/8/8/8 b - - 0 1', level)
  })

  it('rejects an invalid FEN', () => {
    expect(() => getComputerMove('invalid fen', 4)).toThrow()
  })
})

describe('engine worker', () => {
  it('returns a legal move with the original FEN and request ID', async () => {
    const worker = await createWorker()
    const game = new Chess()
    game.move('e4')
    const request: EngineRequest = { fen: game.fen(), level: 1, requestId: 'reply-1' }

    worker.onmessage?.(new MessageEvent('message', { data: request }))

    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    const response = worker.postMessage.mock.calls[0][0]
    expect(response).toEqual({ move: expect.any(Object), fen: request.fen, requestId: request.requestId })
    expect(response.move).not.toBeNull()
    expect(game.move(response.move).color).toBe('b')
  })

  it('returns null without an error for checkmate', async () => {
    const worker = await createWorker()
    const request: EngineRequest = {
      fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1',
      level: 4,
      requestId: 2,
    }

    worker.onmessage?.(new MessageEvent('message', { data: request }))

    expect(worker.postMessage).toHaveBeenCalledWith({ move: null, fen: request.fen, requestId: 2 })
  })

  it('returns an error for invalid FEN and accepts the next request', async () => {
    const worker = await createWorker()
    const request: EngineRequest = { fen: 'invalid fen', level: 4, requestId: 3 }

    worker.onmessage?.(new MessageEvent('message', { data: request }))

    expect(worker.postMessage).toHaveBeenNthCalledWith(1, {
      move: null,
      fen: request.fen,
      requestId: 3,
      error: expect.any(String),
    })

    const nextRequest: EngineRequest = { fen: new Chess().fen(), level: 1, requestId: 4 }
    worker.onmessage?.(new MessageEvent('message', { data: nextRequest }))
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, {
      move: expect.any(Object),
      fen: nextRequest.fen,
      requestId: 4,
    })
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
  })
})
