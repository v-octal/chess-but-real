import { Check, Minus, Swords } from 'lucide-react'
import type { PieceSymbol } from 'chess.js'
import { ChessPiece } from './ChessPiece'
import { CardIcon } from './CardIcon'
import type { LogEntry } from './tactics'

export type FeedEntry = LogEntry & {
  capture?: { success: boolean; piece: PieceSymbol; chance: number; squares: string }
  move?: { san: string; color: 'w' | 'b' }
}

function EntryIcon({ entry }: { entry: FeedEntry }) {
  if (entry.card) return <span className="feed-icon feed-card"><CardIcon card={entry.card} size={13} /></span>
  if (entry.capture) {
    return <span className={`feed-icon ${entry.capture.success ? 'feed-hit' : 'feed-miss'}`}>
      {entry.capture.success ? <Check size={13} /> : <Swords size={13} />}
    </span>
  }
  if (entry.move) return <span className="feed-icon feed-move"><ChessPiece type={entry.move.color === 'w' ? 'p' : 'p'} color={entry.move.color} /></span>
  return <span className="feed-icon feed-info"><Minus size={13} /></span>
}

export function BattleLog({ entries }: { entries: FeedEntry[] }) {
  return <div className="battle-log" aria-label="Battle log">
    {!entries.length && <p className="battle-log-empty">Every card, capture, and order appears here.</p>}
    <ul>
      {entries.map((entry) => <li key={entry.key} className={`feed-entry tone-${entry.tone} side-${entry.by}`}>
        <EntryIcon entry={entry} />
        <span className="feed-body">
          <strong>{entry.label}</strong>
          {entry.detail && <small>{entry.detail}</small>}
        </span>
        <span className="feed-ply">{entry.ply > 0 ? `${Math.ceil(entry.ply / 2)}` : '·'}</span>
      </li>)}
    </ul>
  </div>
}
