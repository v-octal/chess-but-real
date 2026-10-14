import type { Color, PieceSymbol } from 'chess.js'

type Props = { type: PieceSymbol; color: Color; className?: string }

export function ChessPiece({ type, color, className = '' }: Props) {
  const white = color === 'w'
  const fill = white ? '#fffdf4' : '#303431'
  const stroke = white ? '#555c4f' : '#151c17'
  const detail = white ? '#555c4f' : '#a9b2a0'

  return (
    <svg viewBox="0 0 45 45" className={`chess-piece ${className}`} aria-hidden="true" fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {type === 'p' && <g>
        <path d="M22.5 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        <path d="M17.5 20c0-2 2.2-3.5 5-3.5s5 1.5 5 3.5c0 2-1 3-2 4.5.4 3 1.8 5.1 4.5 7.5h-15c2.7-2.4 4.1-4.5 4.5-7.5-1-1.5-2-2.5-2-4.5Z" />
        <path d="M14.5 32h16v4h-16zM12.5 36h20v3h-20z" />
        <path d="M17.5 34h10" stroke={detail} strokeWidth="1" />
      </g>}
      {type === 'r' && <g>
        <path d="M10 8h6v4h4V8h5v4h4V8h6v10l-5 4v10H15V22l-5-4Z" />
        <path d="M10 17h25M15 22h15M16 29h13" fill="none" stroke={detail} />
        <path d="M13 32h19v4H13zM10 36h25v3H10z" />
        <path d="M15 34h15" stroke={detail} strokeWidth="1" />
      </g>}
      {type === 'n' && <g>
        <path d="M14 33c.5-5.8 3.1-8.3 7-12-3 1.2-5.7 3.5-9 3.5-2.4 0-4-2-3-4l4-6.5 6-4.5L20 5l4 3c8 .5 12 9.8 10.5 25Z" />
        <path d="m13 17 4-1M13 22l3-1M23 12c6 4 6 13 4 19" stroke={detail} fill="none" />
        <circle cx="19.2" cy="13.2" r="1.4" fill={detail} stroke="none" />
        <path d="M13 33h21v3H13zM10 36h27v3H10z" />
      </g>}
      {type === 'b' && <g>
        <circle cx="22.5" cy="6.5" r="2.5" />
        <path d="M22.5 9C18 13 15 16 15 20c0 3 3 5 7.5 5S30 23 30 20c0-4-3-7-7.5-11Z" />
        <path d="m23 12-4 8h6" fill="none" stroke={detail} />
        <path d="M19 25c0 3-1 4.5-4 7h15c-3-2.5-4-4-4-7Z" />
        <path d="M13 32h19v4H13zM10 36h25v3H10z" />
        <path d="M17 34h11" stroke={detail} strokeWidth="1" />
      </g>}
      {type === 'q' && <g>
        <path d="m9 13 5 17h17l5-17-9 10-4.5-13L18 23Z" />
        <circle cx="9" cy="11" r="2.5" /><circle cx="16" cy="8" r="2.5" /><circle cx="22.5" cy="6" r="2.5" /><circle cx="29" cy="8" r="2.5" /><circle cx="36" cy="11" r="2.5" />
        <path d="m15 13 3 10m12-10-3 10" stroke={detail} fill="none" />
        <path d="M14 29h17v4H14zM12 33h21v3H12zM10 36h25v3H10z" />
        <path d="M17 31h11M15 35h15" stroke={detail} strokeWidth="1" />
      </g>}
      {type === 'k' && <g>
        <path d="M22.5 4v9m-4-6h8" fill="none" strokeWidth="2" />
        <path d="M22.5 26C15 22 12 17 15 13c2-3 6-2 7.5 1 1.5-3 5.5-4 7.5-1 3 4 0 9-7.5 13Z" />
        <path d="M16 28c-2-4-9-8-8-12 .7-4 6-4 9 0l5.5 10L28 16c3-4 8.3-4 9 0 1 4-6 8-8 12Z" />
        <path d="M15 28h15v5H15zM12 33h21v3H12zM10 36h25v3H10z" />
        <path d="M18 30.5h9M15 35h15" stroke={detail} strokeWidth="1" />
      </g>}
    </svg>
  )
}
