import type { Chess, Color, Move, PieceSymbol, Square } from 'chess.js'
import { getAdjustedCaptureOdds, victimSquare } from './capture'
import type { OddsContext } from './capture'
import { CARDS, canAfford, handOf, legalTargets, other, rankOf, statusAt } from './tactics'
import type { CardId, TacticsState } from './tactics'

export type CardPlay = { card: CardId; targets: Square[] }

const VALUE: Record<PieceSymbol, number> = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 }
const MIN_LEVEL_SCORE = [900, 380, 210, 120]

function attacked(game: Chess, square: Square, by: Color): boolean {
  return (game.attackers(square, by) ?? []).length > 0
}

function defended(game: Chess, square: Square, by: Color): boolean {
  const piece = game.get(square)
  if (!piece) return false
  return (game.attackers(square, by) ?? []).filter((from) => from !== square).length > 0
}

export function oddsContextFor(state: TacticsState, move: Move): OddsContext {
  const square = victimSquare(move)
  const target = other(move.color)
  return {
    guarded: Boolean(statusAt(state, square, 'guarded')?.owner === target),
    exposed: Boolean(statusAt(state, square, 'exposed')?.owner === target),
    assault: state.assault[move.color],
  }
}

/** Odds context for a move given only its squares. Returns an empty context for a quiet move. */
export function contextForMove(game: Chess, state: TacticsState, from: string, to: string): OddsContext {
  const move = game.moves({ verbose: true }).find((item) => item.from === from && item.to === to)
  if (!move?.captured) return {}
  return oddsContextFor(state, move)
}

function capturePlans(game: Chess, state: TacticsState) {
  return game.moves({ verbose: true })
    .filter((move) => move.captured)
    .map((move) => {
      const odds = getAdjustedCaptureOdds(game, move, oddsContextFor(state, move))
      return { move, chance: odds?.chance ?? 0, gain: (odds?.chance ?? 0) / 100 * VALUE[move.captured!] }
    })
    .sort((a, b) => b.gain - a.gain)
}

function bestSquare(squares: Square[], score: (square: Square) => number): { square: Square; score: number } | null {
  let best: { square: Square; score: number } | null = null
  for (const square of squares) {
    const value = score(square)
    if (value <= 0) continue
    if (!best || value > best.score) best = { square, score: value }
  }
  return best
}

function centrality(square: Square): number {
  return 5 - Math.max(Math.abs(square.charCodeAt(0) - 100.5), Math.abs(rankOf(square) - 4.5))
}

function scoreCard(
  game: Chess,
  state: TacticsState,
  color: Color,
  card: CardId,
): CardPlay | null {
  const targets = legalTargets(game, state, color, card)
  if (CARDS[card].target !== 'none' && !targets.length) return null
  const enemy = other(color)

  if (card === 'coronation') {
    if (!targets.length) return null
    const pick = bestSquare(targets, (square) => 1000 + centrality(square))
    return pick ? { card, targets: [pick.square] } : null
  }

  if (card === 'bombard') {
    const pick = bestSquare(targets, (square) => {
      const piece = game.get(square)
      if (!piece) return 0
      const value = VALUE[piece.type]
      const safe = defended(game, square, enemy)
      const invading = color === 'w' ? rankOf(square) >= 4 : rankOf(square) <= 5
      if (value < 300 && !invading) return 0
      return value + (safe ? 160 : 0) + (invading ? 90 : 0)
    })
    return pick ? { card, targets: [pick.square] } : null
  }

  if (card === 'assault') {
    const plan = capturePlans(game, state)[0]
    if (!plan || plan.chance >= 92 || plan.chance <= 0) return null
    if (VALUE[plan.move.captured!] < 200) return null
    return { card, targets: [] }
  }

  if (card === 'expose') {
    const wanted = new Map<Square, number>()
    for (const plan of capturePlans(game, state)) {
      if (plan.chance >= 88) continue
      const square = victimSquare(plan.move)
      wanted.set(square, Math.max(wanted.get(square) ?? 0, VALUE[plan.move.captured!]))
    }
    const pick = bestSquare(targets.filter((square) => wanted.has(square)), (square) => wanted.get(square) ?? 0)
    return pick ? { card, targets: [pick.square] } : null
  }

  if (card === 'fortify') {
    const pick = bestSquare(targets, (square) => {
      const piece = game.get(square)
      if (!piece || !attacked(game, square, enemy)) return 0
      if (statusAt(state, square, 'guarded')) return 0
      const threats = (game.attackers(square, enemy) ?? []).length
      return VALUE[piece.type] * 0.35 + threats * 30
    })
    return pick ? { card, targets: [pick.square] } : null
  }

  if (card === 'recruit') {
    const pawns = game.findPiece({ type: 'p', color }).length
    if (pawns >= 7 || state.command[color] < CARDS.recruit.cost + 3) return null
    const pick = bestSquare(targets, (square) => (
      attacked(game, square, enemy) ? 0 : 40 + centrality(square) * 12 + (defended(game, square, color) ? 20 : 0)
    ))
    return pick ? { card, targets: [pick.square] } : null
  }

  if (card === 'rally') {
    const pick = bestSquare(targets, (square) => {
      const rank = rankOf(square)
      const advance = color === 'w' ? rank : 9 - rank
      const openFile = (game.attackers(square, enemy) ?? []).length === 0
      return advance >= 3 ? advance * 22 + (openFile ? 40 : 0) : 0
    })
    return pick ? { card, targets: [pick.square] } : null
  }

  if (card === 'maneuver') {
    const inDanger = targets.filter((square) => {
      const piece = game.get(square)
      return piece && VALUE[piece.type] >= 300 && attacked(game, square, enemy) && !defended(game, square, color)
    })
    if (!inDanger.length) return null
    const first = inDanger[0]
    const second = legalTargets(game, state, color, card, first)[0]
    return second ? { card, targets: [first, second] } : null
  }

  return null
}

export function chooseCardPlay(
  game: Chess,
  state: TacticsState,
  color: Color,
  level: number,
): CardPlay | null {
  const difficulty = Math.min(4, Math.max(1, Math.trunc(level) || 1))
  const limit = difficulty >= 3 ? 2 : 1
  if (state.playedThisTurn >= limit) return null
  const threshold = MIN_LEVEL_SCORE[difficulty - 1]
  const reserve = difficulty <= 2 ? 2 : 0

  let best: { play: CardPlay; score: number } | null = null
  for (const card of handOf(state, color)) {
    if (!canAfford(state, color, card)) continue
    if (state.command[color] - CARDS[card].cost < reserve && card !== 'coronation') continue
    const play = scoreCard(game, state, color, card)
    if (!play) continue
    const score = scoreOf(game, state, card, play)
    if (score >= threshold && (!best || score > best.score)) best = { play, score }
  }
  return best?.play ?? null
}

function scoreOf(game: Chess, state: TacticsState, card: CardId, play: CardPlay): number {
  if (card === 'coronation') return 5000
  if (card === 'bombard') {
    const piece = game.get(play.targets[0])
    return piece ? 300 + VALUE[piece.type] : 0
  }
  if (card === 'assault') {
    const plan = capturePlans(game, state)[0]
    return plan ? 260 + plan.gain : 0
  }
  if (card === 'expose' || card === 'fortify') {
    const piece = game.get(play.targets[0])
    return piece ? 200 + VALUE[piece.type] * 0.4 : 0
  }
  if (card === 'recruit') return 240
  if (card === 'rally') return 220
  return 150
}
