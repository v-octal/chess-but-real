import { Chess } from 'chess.js'
import type { Color, Move, PieceSymbol } from 'chess.js'
import { getCaptureOdds } from './capture'

export type ComputerMove = {
  from: string
  to: string
  promotion?: string
}

const pieceValues: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 900,
  k: 0,
}

const settings = [
  { depth: 1, milliseconds: 120 },
  { depth: 2, milliseconds: 300 },
  { depth: 3, milliseconds: 700 },
  { depth: 3, milliseconds: 1400 },
]
const mateScore = 100_000
const searchTimeout = Symbol('searchTimeout')

function evaluate(game: Chess): number {
  const board = game.board()
  const pawns: Record<Color, number[]> = {
    w: Array<number>(8).fill(0),
    b: Array<number>(8).fill(0),
  }
  const bishops: Record<Color, number> = { w: 0, b: 0 }
  let nonPawnMaterial = 0

  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue
      if (piece.type === 'p') {
        pawns[piece.color][piece.square.charCodeAt(0) - 97] += 1
      } else {
        nonPawnMaterial += pieceValues[piece.type]
      }
      if (piece.type === 'b') bishops[piece.color] += 1
    }
  }

  const endgame = nonPawnMaterial <= 2600
  let score = 0

  for (let row = 0; row < 8; row += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[row][file]
      if (!piece) continue
      const rank = piece.color === 'w' ? 7 - row : row
      const center = 7 - Math.abs(3.5 - file) - Math.abs(3.5 - row)
      const enemy = piece.color === 'w' ? 'b' : 'w'
      let positional = 0

      switch (piece.type) {
        case 'p':
          positional = rank * (endgame ? 14 : 8) + (3.5 - Math.abs(3.5 - file)) * 5
          if (pawns[piece.color][file] > 1) positional -= 14
          if (!(pawns[piece.color][file - 1] || pawns[piece.color][file + 1])) {
            positional -= 12
          }
          break
        case 'n':
          positional = center * 14 - (rank === 0 ? 16 : 0)
          break
        case 'b':
          positional = center * 7 + rank * 3
          break
        case 'r':
          positional = rank * 2 + (rank === 6 ? 20 : 0)
          if (!pawns[piece.color][file]) positional += pawns[enemy][file] ? 12 : 22
          break
        case 'q':
          positional = center * 3 - (!endgame && rank > 2 ? 12 : 0)
          break
        case 'k':
          positional = endgame ? center * 12 : -center * 10 - rank * 14
          if (!endgame && rank === 0 && (file === 2 || file === 6)) positional += 35
          break
      }

      score += (piece.color === 'w' ? 1 : -1) * (pieceValues[piece.type] + positional)
    }
  }

  if (bishops.w >= 2) score += 25
  if (bishops.b >= 2) score -= 25
  return game.turn() === 'w' ? score : -score
}

function priority(move: Move, chance: number | null): number {
  const probability = (chance ?? 100) / 100
  return (move.san.endsWith('#') ? mateScore * probability : 0)
    + (move.captured ? (pieceValues[move.captured] * 10 - pieceValues[move.piece]) * probability + (chance ?? 100) : 0)
    + (move.promotion ? pieceValues[move.promotion] * probability : 0)
    + (move.san.endsWith('+') ? 40 * probability : 0)
    + (move.isKingsideCastle() || move.isQueensideCastle() ? 30 : 0)
}

function orderedMoves(game: Chess) {
  return game.moves({ verbose: true })
    .map((move) => ({ move, chance: getCaptureOdds(game, move)?.chance ?? null }))
    .sort((a, b) => priority(b.move, b.chance) - priority(a.move, a.chance))
}

function checkTime(deadline: number): void {
  if (performance.now() >= deadline) throw searchTimeout
}

function failedCapturePosition(game: Chess): Chess {
  const [board, turn, castling, , halfmove, fullmove] = game.fen().split(' ')
  return new Chess(`${board} ${turn === 'w' ? 'b' : 'w'} ${castling} - ${Number(halfmove) + 1} ${Number(fullmove) + (turn === 'b' ? 1 : 0)}`)
}

function scoreMove(game: Chess, move: Move, chance: number | null, depth: number, alpha: number, beta: number, ply: number, deadline: number): number {
  const inCheck = chance !== null && game.isCheck()
  game.move(move)
  let successScore: number
  try {
    successScore = -search(game, depth - 1, chance === null ? -beta : -Infinity, chance === null ? -alpha : Infinity, ply + 1, deadline)
  } finally {
    game.undo()
  }
  if (chance === null) return successScore

  let failureScore = -mateScore + ply + 1
  if (!inCheck) {
    checkTime(deadline)
    failureScore = -search(failedCapturePosition(game), depth - 1, -Infinity, Infinity, ply + 1, deadline)
  }

  const probability = chance / 100
  return probability * successScore + (1 - probability) * failureScore
}

function search(game: Chess, depth: number, alpha: number, beta: number, ply: number, deadline: number): number {
  checkTime(deadline)

  if (depth === 0) {
    if (game.isCheckmate()) return -mateScore + ply
    if (game.isDraw()) return 0
    return evaluate(game)
  }

  const moves = orderedMoves(game)
  if (moves.length === 0) return game.isCheck() ? -mateScore + ply : 0
  if (game.isDrawByFiftyMoves() || game.isInsufficientMaterial() || game.isThreefoldRepetition()) return 0
  let best = -Infinity

  for (const { move, chance } of moves) {
    checkTime(deadline)
    const score = scoreMove(game, move, chance, depth, alpha, beta, ply, deadline)
    best = Math.max(best, score)
    alpha = Math.max(alpha, score)
    if (alpha >= beta) break
  }

  return best
}

function toComputerMove(move: Move): ComputerMove {
  return move.promotion
    ? { from: move.from, to: move.to, promotion: move.promotion }
    : { from: move.from, to: move.to }
}

export function getComputerMove(fen: string, level: number): ComputerMove | null {
  const difficulty = Number.isFinite(level) ? Math.min(4, Math.max(1, Math.trunc(level))) : 1
  const { depth, milliseconds } = settings[difficulty - 1]
  const deadline = performance.now() + milliseconds
  const game = new Chess(fen)
  if (game.isGameOver()) return null

  const moves = orderedMoves(game)
  if (moves.length === 0) return null
  let bestMove = moves[0].move
  if (moves.length === 1 || (moves[0].chance === null && bestMove.san.endsWith('#'))) return toComputerMove(bestMove)

  for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
    let iterationBest = bestMove
    let bestScore = -Infinity
    const scores = new Map<Move, number>()

    try {
      for (const { move, chance } of moves) {
        checkTime(deadline)
        const score = scoreMove(game, move, chance, currentDepth, bestScore, Infinity, 0, deadline)
        checkTime(deadline)
        scores.set(move, score)
        if (score > bestScore) {
          bestScore = score
          iterationBest = move
        }
      }
    } catch (error) {
      if (error !== searchTimeout) throw error
      break
    }

    bestMove = iterationBest
    if (bestScore >= mateScore - currentDepth) break
    moves.sort((a, b) => (scores.get(b.move) ?? -Infinity) - (scores.get(a.move) ?? -Infinity))
  }

  return toComputerMove(bestMove)
}
