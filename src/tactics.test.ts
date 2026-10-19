import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type { Color, Square } from 'chess.js'
import {
  CARDS, DECK, HAND_SIZE, MAX_COMMAND, MAX_PAWNS, STATUS_ROUNDS,
  beginTurn, canAfford, createDeck, createTactics, handOf, isPlayable, isSurge,
  legalTargets, nextOf, other, playCard, roundsLeft, statusesAtPly, syncStatuses,
} from './tactics'
import type { CardId, TacticsState } from './tactics'
import { getAdjustedCaptureOdds, resolveMove } from './capture'
import { buildPgn, buildPosition, replayInto, restoreGame, trimRecord } from './record'
import type { GameRecord } from './record'
import { chooseCardPlay, contextForMove, oddsContextFor } from './tacticsAi'

function stateWith(cards: CardId | CardId[], command = 10, ply = 0): TacticsState {
  const wanted = Array.isArray(cards) ? cards : [cards]
  const deck = [...wanted, ...DECK.filter((id) => !wanted.includes(id))]
  const base = createTactics('seed', ply)
  return { ...base, command: { w: command, b: command }, decks: { w: deck, b: [...deck] } }
}

function play(fen: string, card: CardId, targets: string[] = [], color: Color = 'w', command = 10) {
  const game = new Chess(fen)
  const state = stateWith(card, command)
  const result = playCard(game, state, color, card, game.history().length, targets as Square[])
  return { game, state, result }
}

const OPENING = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('deck and command', () => {
  it('shuffles deterministically from a seed and keeps every card', () => {
    expect(createDeck('same')).toEqual(createDeck('same'))
    expect(new Set(createDeck('same')).size).toBe(DECK.length)
    expect(createDeck('a')).not.toEqual(createDeck('b'))
  })

  it('separates the hands of the two sides but keeps both complete', () => {
    const tactics = createTactics('game-1')
    expect(new Set(tactics.decks.w)).toEqual(new Set(DECK))
    expect(new Set(tactics.decks.b)).toEqual(new Set(DECK))
    expect(handOf(tactics, 'w')).toHaveLength(HAND_SIZE)
    expect(nextOf(tactics, 'w')).toBe(tactics.decks.w[HAND_SIZE])
  })

  it('grants regen at the start of a turn and never passes the cap', () => {
    const start = createTactics('game-1', -1)
    expect(start.command.w).toBe(1)
    const first = beginTurn(start, 'w', 0, false)
    expect(first.command.w).toBe(3)
    expect(first.lastPly).toBe(0)
    expect(first.assault).toEqual({ w: false, b: false })
    const full = beginTurn({ ...first, command: { w: MAX_COMMAND, b: 0 } }, 'w', 1, false)
    expect(full.command.w).toBe(MAX_COMMAND)
    expect(beginTurn(first, 'w', 2, true).command.w).toBe(6)
  })

  it('reports surge only after the surge round', () => {
    expect(isSurge(new Chess(OPENING))).toBe(false)
    expect(isSurge(new Chess('7k/8/8/8/8/8/8/7K w - - 0 20'))).toBe(false)
    expect(isSurge(new Chess('7k/8/8/8/8/8/8/7K w - - 0 21'))).toBe(true)
  })

  it('cycles a played card to the back of the queue and charges its cost', () => {
    const { result, state } = play(OPENING, 'assault')
    expect(result).not.toBeNull()
    expect(result!.state.command.w).toBe(state.command.w - CARDS.assault.cost)
    expect(result!.state.decks.w.at(-1)).toBe('assault')
    expect(handOf(result!.state, 'w')).not.toContain('assault')
    expect(result!.state.playedThisTurn).toBe(1)
  })

  it('refuses a card that is not in hand, too expensive, or already armed', () => {
    const game = new Chess(OPENING)
    const state = stateWith('recruit', 10)
    expect(playCard(game, state, 'w', 'bombard', 0, [])).toBeNull()
    expect(playCard(game, state, 'w', 'recruit', 0, ['d4'])).not.toBeNull()
    expect(canAfford(stateWith('bombard', 4), 'w', 'bombard')).toBe(false)
    const armed = { ...state, assault: { w: true, b: false } }
    expect(playCard(game, stateWith('assault'), 'w', 'assault', 0, [])).not.toBeNull()
    expect(playCard(game, stateWith('assault'), 'w', 'assault', 0, [])).not.toBeNull()
    expect(playCard(game, armed, 'w', 'assault', 0, [])).toBeNull()
  })
})

describe('recruit', () => {
  it('deploys a pawn on an empty square of your own half', () => {
    const { game, result } = play(OPENING, 'recruit', ['d4'])
    expect(result).not.toBeNull()
    expect(game.get('d4')).toEqual({ type: 'p', color: 'w' })
    expect(game.turn()).toBe('w')
    expect(game.history()).toEqual([])
    expect(result!.effect.ops).toEqual([{ type: 'put', square: 'd4', piece: 'p', color: 'w' }])
  })

  it('keeps the deploy zone off the back rank and inside your half', () => {
    const { game, state } = play(OPENING, 'recruit', [])
    const targets = legalTargets(game, state, 'w', 'recruit')
    expect(targets).not.toContain('e1')
    expect(targets).not.toContain('d5')
    expect(targets.every((square) => Number(square[1]) >= 2 && Number(square[1]) <= 4)).toBe(true)
    expect(targets).toContain('d4')
    const black = legalTargets(game, state, 'b', 'recruit')
    expect(black.every((square) => Number(square[1]) >= 5 && Number(square[1]) <= 7)).toBe(true)
  })

  it('stops at the pawn limit', () => {
    const game = new Chess('6k1/PPPPPPPP/P7/8/8/8/PPPPPPPP/4K3 w - - 0 1')
    expect(legalTargets(game, stateWith('recruit'), 'w', 'recruit')).toEqual([])
    expect(isPlayable(game, stateWith('recruit'), 'w', 'recruit')).toBe(false)
    expect(MAX_PAWNS).toBeGreaterThan(8)
  })
})

describe('rally', () => {
  it('pushes a pawn one square without using the move', () => {
    const { game } = play(OPENING, 'rally', ['e2'])
    expect(game.get('e3')).toEqual({ type: 'p', color: 'w' })
    expect(game.get('e2')).toBeUndefined()
    expect(game.turn()).toBe('w')
  })

  it('crowns a pawn that reaches the last rank', () => {
    const { game } = play('7k/P7/8/8/8/8/8/3K4 w - - 0 1', 'rally', ['a7'])
    expect(game.get('a8')).toEqual({ type: 'q', color: 'w' })
  })

  it('refuses a blocked pawn and a pinned pawn', () => {
    const blocked = new Chess('7k/8/8/8/8/4p3/4P3/4K3 w - - 0 1')
    expect(legalTargets(blocked, stateWith('rally'), 'w', 'rally')).toEqual([])
    const pinned = new Chess('4k3/8/8/8/8/8/1K1P3r/8 w - - 0 1')
    expect(legalTargets(pinned, stateWith('rally'), 'w', 'rally')).toEqual([])
  })
})

describe('maneuver', () => {
  it('swaps two of your pieces in two steps', () => {
    const game = new Chess('7k/8/8/8/8/8/8/R3K1NR w KQ - 0 1')
    const state = stateWith('maneuver')
    const first = legalTargets(game, state, 'w', 'maneuver')
    expect(first).toContain('a1')
    const second = legalTargets(game, state, 'w', 'maneuver', 'a1')
    expect(second).toContain('g1')
    expect(second).not.toContain('a1')
    expect(playCard(game, state, 'w', 'maneuver', 0, ['a1', 'g1'])).not.toBeNull()
    expect(game.get('a1')).toEqual({ type: 'n', color: 'w' })
    expect(game.get('g1')).toEqual({ type: 'r', color: 'w' })
  })

  it('refuses the king, the same square twice, and a pawn on the back rank', () => {
    const game = new Chess('7k/8/8/8/8/8/8/R3K2R w KQ - 0 1')
    const state = stateWith('maneuver')
    expect(legalTargets(game, state, 'w', 'maneuver')).not.toContain('e1')
    expect(playCard(game, state, 'w', 'maneuver', 0, ['a1', 'a1'])).toBeNull()
    const withPawn = new Chess('7k/8/8/8/8/8/P6R/R3K3 w KQ - 0 1')
    expect(legalTargets(withPawn, state, 'w', 'maneuver', 'a2')).not.toContain('h1')
  })

  it('refuses a swap that leaves your own king in check', () => {
    const game = new Chess('7k/8/8/8/8/8/8/r3K1NR w KQ - 0 1')
    const state = stateWith('maneuver')
    expect(playCard(game, state, 'w', 'maneuver', 0, ['g1', 'e1'])).toBeNull()
  })
})

describe('bombard', () => {
  it('destroys an enemy pawn, knight, or bishop from range', () => {
    for (const [fen, target] of [['7k/4p3/8/8/3n4/8/8/4K3 w - - 0 1', 'e7'], ['7k/4p3/8/8/3n4/8/8/4K3 w - - 0 1', 'd4'], ['7k/8/8/3b4/8/8/8/4K3 w - - 0 1', 'd5']] as [string, string][]) {
      const { game, result } = play(fen, 'bombard', [target])
      expect(result).not.toBeNull()
      expect(game.get(target as Square)).toBeUndefined()
    }
  })

  it('refuses a rook, queen, king, or your own piece', () => {
    const state = stateWith('bombard')
    const game = new Chess('7k/8/8/8/8/8/8/R3K2Q w KQ - 0 1')
    expect(legalTargets(game, state, 'w', 'bombard')).toEqual([])
    const enemy = new Chess('3k4/8/8/3r3q/8/8/8/4K3 w - - 0 1')
    expect(legalTargets(enemy, state, 'w', 'bombard')).toEqual([])
  })

  it('is blocked by a guard', () => {
    const game = new Chess('7k/8/8/3N4/8/8/8/4K3 w - - 0 1')
    const guarded = playCard(game, stateWith('fortify'), 'w', 'fortify', 0, ['d5'])
    expect(guarded).not.toBeNull()
    const strike = stateWith('bombard')
    const withGuard = { ...strike, statuses: guarded!.state.statuses }
    expect(legalTargets(game, withGuard, 'b', 'bombard')).toEqual([])
    expect(legalTargets(game, strike, 'b', 'bombard')).toEqual(['d5'])
  })
})

describe('coronation', () => {
  it('crowns a pawn that has crossed into the enemy half', () => {
    const { game } = play('7k/8/8/P7/8/8/8/4K3 w - - 0 1', 'coronation', ['a5'])
    expect(game.get('a5')).toEqual({ type: 'q', color: 'w' })
  })

  it('refuses a pawn still on your own half', () => {
    const game = new Chess('7k/8/8/8/8/P7/8/4K3 w - - 0 1')
    expect(legalTargets(game, stateWith('coronation'), 'w', 'coronation')).toEqual([])
    const black = new Chess('7k/8/8/8/8/p7/8/4K3 b - - 0 1')
    expect(legalTargets(black, stateWith('coronation'), 'b', 'coronation')).toEqual(['a3'])
  })
})

describe('marks', () => {
  it('guards and exposes for two rounds and clears the other mark', () => {
    const game = new Chess('7k/8/8/8/8/8/8/R3K3 w KQ - 0 1')
    const guard = playCard(game, stateWith('fortify'), 'w', 'fortify', 0, ['a1'])!
    expect(guard.state.statuses).toEqual([{ kind: 'guarded', square: 'a1', owner: 'w', by: 'w', expiresAtPly: STATUS_ROUNDS * 2 }])
    expect(roundsLeft(guard.state.statuses[0], 0)).toBe(2)
    expect(roundsLeft(guard.state.statuses[0], 3)).toBe(1)
    const blackHand = { ...guard.state, decks: { ...guard.state.decks, b: stateWith(['expose', 'fortify']).decks.b } }
    const expose = playCard(game, blackHand, 'b', 'expose', 1, ['a1'])
    expect(expose).not.toBeNull()
    expect(expose!.state.statuses).toHaveLength(1)
    expect(expose!.state.statuses[0]).toMatchObject({ kind: 'exposed', square: 'a1', owner: 'w', by: 'b' })
  })

  it('expires a mark after two rounds and drops it when the piece leaves', () => {
    const game = new Chess('7k/8/8/8/8/8/8/R3K3 w KQ - 0 1')
    const guard = playCard(game, stateWith('fortify'), 'w', 'fortify', 0, ['a1'])!
    expect(syncStatuses(guard.state, game, 3).statuses).toHaveLength(1)
    expect(syncStatuses(guard.state, game, 4).statuses).toHaveLength(0)
    const moved = new Chess(game.fen())
    moved.move('Rb1')
    expect(syncStatuses(guard.state, moved, 1).statuses).toHaveLength(0)
  })

  it('exposes only enemies and guards only your own pieces', () => {
    const game = new Chess('3k4/8/8/3p4/8/8/3P4/4K3 w - - 0 1')
    expect(legalTargets(game, stateWith('expose'), 'w', 'expose')).toEqual(['d5'])
    expect(legalTargets(game, stateWith('fortify'), 'w', 'fortify')).toEqual(['d2'])
  })

  it('rebuilds the marks of a past ply from the effect timeline', () => {
    const game = new Chess('7k/8/8/8/8/8/8/R3K3 w KQ - 0 1')
    const guard = playCard(game, stateWith('fortify'), 'w', 'fortify', 0, ['a1'])!
    expect(statusesAtPly([guard.effect], game, 0)).toHaveLength(1)
    expect(statusesAtPly([guard.effect], game, 3)).toHaveLength(1)
    expect(statusesAtPly([guard.effect], game, 4)).toHaveLength(0)
  })
})

describe('targeting simulation', () => {
  it('leaves the board untouched while checking targets and playability', () => {
    const fen = '7k/8/8/3Pp3/8/8/8/K7 w - e6 0 2'
    const game = new Chess(fen)
    const cards: CardId[] = ['recruit', 'rally', 'maneuver', 'fortify', 'expose', 'assault', 'bombard', 'coronation']
    for (const card of cards) {
      const state = stateWith(card)
      legalTargets(game, state, 'w', card)
      isPlayable(game, state, 'w', card)
    }
    expect(game.fen()).toBe(fen)
    expect(game.moves({ square: 'd5' })).toContain('dxe6')
  })
})

describe('odds with marks', () => {
  const FEN = '7k/8/8/8/8/8/p7/R1K5 w - - 0 1'

  function captureMove(game: Chess) {
    const move = game.moves({ verbose: true }).find((item) => item.from === 'a1' && item.to === 'a2')
    expect(move).toBeDefined()
    return move!
  }

  it('leaves the base odds untouched without marks', () => {
    const game = new Chess(FEN)
    const odds = getAdjustedCaptureOdds(game, captureMove(game), oddsContextFor(createTactics('x'), captureMove(game)))
    expect(odds).toMatchObject({ chance: 82, guardPenalty: 0, exposeBonus: 0, assaultBonus: 0 })
  })

  it('applies guard, expose, and assault on top of the base chance', () => {
    const game = new Chess(FEN)
    const move = captureMove(game)
    expect(getAdjustedCaptureOdds(game, move, { guarded: true })!.chance).toBe(52)
    expect(getAdjustedCaptureOdds(game, move, { exposed: true })!.chance).toBe(99)
    expect(getAdjustedCaptureOdds(game, move, { assault: true })!.chance).toBe(99)
    expect(getAdjustedCaptureOdds(game, move, { guarded: true, exposed: true, assault: true })!.chance).toBe(99)
  })

  it('resolves the roll against the marked chance', () => {
    const game = new Chess(FEN)
    const failed = resolveMove(game, { from: 'a1', to: 'a2' }, 0.6, { guarded: true })
    expect(failed.capture).toMatchObject({ chance: 52, success: false, guardPenalty: -30 })
    const other0 = new Chess(FEN)
    const won = resolveMove(other0, { from: 'a1', to: 'a2' }, 0.6, { exposed: true })
    expect(won.capture).toMatchObject({ success: true, exposeBonus: 30 })
  })

  it('reads the marks of a position for a square pair', () => {
    const game = new Chess(FEN)
    const state = playCard(game, stateWith('fortify'), 'b', 'fortify', 0, ['a2'])!.state
    expect(contextForMove(game, state, 'a1', 'a2')).toEqual({ guarded: true, exposed: false, assault: false })
    expect(contextForMove(game, state, 'a1', 'b1')).toEqual({})
  })
})

describe('record replay and pgn', () => {
  function buildRecord(): { record: GameRecord; game: Chess } {
    const game = new Chess()
    const state = stateWith(['recruit', 'expose'], 10, 0)
    const recruit = playCard(game, state, 'w', 'recruit', 0, ['d4'])!
    game.move('e4')
    game.move('e5')
    const exposed = playCard(game, recruit.state, 'w', 'expose', 2, ['e5'])!
    game.move('Nf3')
    const record: GameRecord = {
      startFen: OPENING,
      moves: game.history(),
      headers: game.getHeaders() as Record<string, string>,
      comments: [{ ply: 1, comment: 'Recruit on d4.' }],
      effects: [recruit.effect, exposed.effect],
    }
    return { record, game }
  }

  it('replays card effects between the moves they were played in', () => {
    const { record, game } = buildRecord()
    const clone = new Chess()
    replayInto(clone, record, record.moves.length)
    expect(clone.fen()).toEqual(game.fen())
    expect(buildPosition(record, 1).get('d4')).toEqual({ type: 'p', color: 'w' })
    expect(buildPosition(record, 0).get('d4')).toEqual({ type: 'p', color: 'w' })
    expect(buildPosition(record, 0).history()).toEqual([])
  })

  it('restores a saved game and trims it for undo', () => {
    const { record, game } = buildRecord()
    expect(restoreGame(record, '').fen()).toEqual(game.fen())
    const trimmed = trimRecord(record, 1)
    expect(trimmed.moves).toEqual(['e4'])
    expect(trimmed.effects).toHaveLength(1)
    expect(trimmed.comments).toHaveLength(1)
    const rebuilt = new Chess()
    replayInto(rebuilt, record, 1)
    expect(rebuilt.fen()).toEqual(buildPosition(trimmed, 1).fen())
  })

  it('writes card notes and move numbers into the pgn', () => {
    const { record } = buildRecord()
    const pgn = buildPgn(record)
    expect(pgn).toContain('1. e4 {Recruit on d4.}')
    expect(pgn).not.toContain('[FEN')
    expect(pgn.trim().endsWith('*')).toBe(true)
    expect(buildPgn({ ...record, startFen: '7k/8/8/8/8/8/8/7K w - - 0 9' }, '1-0')).toContain('[SetUp "1"]')
    expect(buildPgn({ ...record, moves: [] }, '1/2-1/2')).toContain('[Result "1/2-1/2"]')
  })

  it('restores from a legacy pgn-only save', () => {
    const game = new Chess()
    game.move('e4')
    game.move('e5')
    expect(restoreGame(undefined, game.pgn()).fen()).toEqual(game.fen())
  })
})

describe('computer card choice', () => {
  it('takes a free coronation', () => {
    const game = new Chess('7k/8/8/P7/8/8/8/4K3 w - - 0 1')
    const play = chooseCardPlay(game, stateWith('coronation'), 'w', 4)
    expect(play).toEqual({ card: 'coronation', targets: ['a5'] })
  })

  it('stays quiet at level 1 with nothing to gain', () => {
    const game = new Chess(OPENING)
    expect(chooseCardPlay(game, stateWith('maneuver'), 'w', 1)).toBeNull()
  })

  it('respects the per-turn card limit', () => {
    const game = new Chess('7k/8/8/P7/8/8/8/4K3 w - - 0 1')
    const state = { ...stateWith('coronation'), playedThisTurn: 2 }
    expect(chooseCardPlay(game, state, 'w', 4)).toBeNull()
  })

  it('never returns a play the rules would refuse', () => {
    const positions = [
      OPENING,
      '7k/4p3/8/3n4/8/8/3P4/R3K2R w KQ - 0 1',
      'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1',
    ]
    for (const fen of positions) {
      for (const card of DECK) {
        for (const level of [1, 2, 3, 4]) {
          const game = new Chess(fen)
          const color = game.turn()
          const state = stateWith(card, 10)
          const play = chooseCardPlay(game, state, color, level)
          if (!play) continue
          expect(playCard(new Chess(fen), state, color, play.card, 0, play.targets)).not.toBeNull()
        }
      }
    }
  })

  it('keeps both sides symmetric through the other() helper', () => {
    expect(other('w')).toBe('b')
    expect(other('b')).toBe('w')
  })
})
