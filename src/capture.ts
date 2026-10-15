import type { Chess, Color, Move, PieceSymbol, Square } from 'chess.js'

export type CaptureOdds = {
  chance: number
  strengthBonus: number
  supportBonus: number
  attackers: number
  defenders: number
}

export type CaptureAttempt = CaptureOdds & {
  ply: number
  from: Square
  to: Square
  piece: PieceSymbol
  target: PieceSymbol
  color: Color
  roll: number
  success: boolean
}

const strengths: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 4,
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function getCaptureOdds(game: Chess, move: Move): CaptureOdds | null {
  if (!move.captured) return null

  const strengthBonus = clamp(3 * (strengths[move.piece] - strengths[move.captured]), -15, 15)
  const attackers = game.attackers(move.to, move.color).filter((square) => square !== move.from).length
  const victimSquare = move.isEnPassant() ? (`${move.to[0]}${move.from[1]}` as Square) : move.to
  const defenders = game.attackers(victimSquare, move.color === 'w' ? 'b' : 'w').length
  const supportBonus = clamp(8 * (attackers - defenders), -16, 16)

  return {
    chance: clamp(70 + strengthBonus + supportBonus, 40, 95),
    strengthBonus,
    supportBonus,
    attackers,
    defenders,
  }
}

export function isCaptureRepetition(game: Chess): boolean {
  const history = game.history({ verbose: true })
  const current = game.fen().split(' ').slice(0, 4).join(' ')
  let count = 1

  for (const move of history) {
    if (move.before.split(' ').slice(0, 4).join(' ') === current) count += 1
  }

  return count >= 3
}

export function isCaptureGameOver(game: Chess): boolean {
  return game.isCheckmate()
    || game.isStalemate()
    || game.isInsufficientMaterial()
    || game.isDrawByFiftyMoves()
    || isCaptureRepetition(game)
}

export function resolveMove(
  game: Chess,
  input: { from: string; to: string; promotion?: string },
  roll?: number,
): { move: Move | null; capture: CaptureAttempt | null; defeated: Color | null } {
  if (isCaptureGameOver(game)) throw new Error('Game is over')

  const move = game.moves({ verbose: true }).find((candidate) => (
    candidate.from === input.from && candidate.to === input.to && candidate.promotion === input.promotion
  ))
  if (!move) throw new Error('Illegal move')
  if (roll !== undefined && (!Number.isFinite(roll) || roll < 0 || roll >= 1)) {
    throw new RangeError('Roll must be finite and within [0, 1)')
  }

  const odds = getCaptureOdds(game, move)
  if (!odds || !move.captured) return { move: game.move(move), capture: null, defeated: null }

  const captureRoll = roll ?? crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
  const capture: CaptureAttempt = {
    ...odds,
    ply: game.history().length + 1,
    from: move.from,
    to: move.to,
    piece: move.piece,
    target: move.captured,
    color: move.color,
    roll: captureRoll,
    success: captureRoll < odds.chance / 100,
  }

  if (!capture.success && game.isCheck()) return { move: null, capture, defeated: move.color }
  return { move: game.move(capture.success ? move : null), capture, defeated: null }
}
