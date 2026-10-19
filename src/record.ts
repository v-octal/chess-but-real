import { Chess } from 'chess.js'
import { applyEffect } from './tactics'
import type { CardEffect } from './tactics'

export const DEFAULT_POSITION = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export type CommentRecord = { ply: number; comment: string }

export type GameRecord = {
  startFen: string
  moves: string[]
  headers: Record<string, string>
  comments: CommentRecord[]
  effects: CardEffect[]
}

export function emptyRecord(startFen: string): GameRecord {
  return { startFen, moves: [], headers: {}, comments: [], effects: [] }
}

/**
 * Rebuilds a position from the record.
 * Card effects are applied between the moves they were played in, so the
 * replayed position matches the position the player saw.
 */
export function replayInto(game: Chess, record: GameRecord, uptoPly: number): void {
  game.load(record.startFen, { preserveHeaders: true })
  const limit = Math.max(0, Math.min(uptoPly, record.moves.length))
  for (const effect of record.effects) if (effect.ply === 0) applyEffect(game, effect)
  for (let ply = 0; ply < limit; ply += 1) {
    game.move(record.moves[ply])
    for (const effect of record.effects) if (effect.ply === ply + 1) applyEffect(game, effect)
  }
}

export function buildPosition(record: GameRecord, uptoPly: number): Chess {
  const game = new Chess()
  replayInto(game, record, uptoPly)
  return game
}

export function restoreGame(record: GameRecord | undefined, pgn: string): Chess {
  if (!record) {
    const game = new Chess()
    if (pgn) game.loadPgn(pgn)
    return game
  }
  const game = buildPosition(record, record.moves.length)
  Object.entries(record.headers).forEach(([key, value]) => game.setHeader(key, value))
  return game
}

export function trimRecord(record: GameRecord, uptoPly: number): GameRecord {
  return {
    ...record,
    moves: record.moves.slice(0, uptoPly),
    comments: record.comments.filter((comment) => comment.ply <= uptoPly),
    effects: record.effects.filter((effect) => effect.ply <= uptoPly),
  }
}

function cleanComment(text: string): string {
  return text.replaceAll('{', '[').replaceAll('}', ']')
}

/** Writes a PGN document. chess.js cannot keep comments on a position that a card changed. */
export function buildPgn(record: GameRecord, result?: string): string {
  const startFen = record.startFen || DEFAULT_POSITION
  const tokens = startFen.split(' ')
  const startTurn = tokens[1] === 'b' ? 'b' : 'w'
  const startNumber = Number(tokens[5]) || 1
  const headers: Record<string, string> = { ...record.headers }
  if (startFen !== DEFAULT_POSITION) {
    headers.SetUp = '1'
    headers.FEN = startFen
  } else {
    delete headers.SetUp
    delete headers.FEN
  }
  if (result) headers.Result = result
  if (!headers.Result) headers.Result = '*'

  const commentAt = (ply: number) => {
    const comment = record.comments.find((entry) => entry.ply === ply)
    return comment ? ` {${cleanComment(comment.comment)}}` : ''
  }

  const body = record.moves.map((san, index) => {
    const white = (startTurn === 'w') === (index % 2 === 0)
    const number = startNumber + Math.floor((index + (startTurn === 'w' ? 0 : 1)) / 2)
    const prefix = white ? `${number}.` : index === 0 ? `${number}...` : ''
    return [prefix, `${san}${commentAt(index + 1)}`].filter(Boolean).join(' ')
  }).join(' ')

  const opening = record.comments.find((entry) => entry.ply === 0)
  const head = opening ? `{${cleanComment(opening.comment)}} ` : ''
  const lines = Object.entries(headers)
    .filter(([, value]) => value)
    .map(([key, value]) => `[${key} "${cleanComment(value)}"]`)
  return `${lines.join('\n')}\n\n${head}${body} ${headers.Result}`.trim()
}
