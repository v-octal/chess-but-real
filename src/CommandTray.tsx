import { Zap } from 'lucide-react'
import { CARDS, MAX_COMMAND, handOf, nextOf } from './tactics'
import type { CardId, TacticsState } from './tactics'
import { CardIcon } from './CardIcon'
import type { Color } from 'chess.js'

const ROLE_LABEL: Record<CardId, string> = {
  recruit: 'Deploy',
  rally: 'Order',
  maneuver: 'Order',
  fortify: 'Support',
  expose: 'Mark',
  assault: 'Attack',
  bombard: 'Strike',
  coronation: 'Support',
}

type Props = {
  state: TacticsState
  color: Color
  surge: boolean
  regen: number
  locked: boolean
  activeIndex: number | null
  playable: Record<CardId, boolean>
  gained: number | null
  onSelect: (index: number) => void
}

function Card({ card, index, state, color, playable, locked, active, onSelect }: {
  card: CardId
  index: number
  state: TacticsState
  color: Color
  playable: Record<CardId, boolean>
  locked: boolean
  active: boolean
  onSelect: (index: number) => void
}) {
  const def = CARDS[card]
  const affordable = state.command[color] >= def.cost
  const usable = affordable && playable[card]
  const disabled = locked || !usable
  const reason = !affordable
    ? `Needs ${def.cost} command. You have ${state.command[color]}.`
    : !playable[card]
      ? 'No legal target for this card right now.'
      : def.rule
  return <button
    type="button"
    className={`tactic-card role-${def.role} ${active ? 'card-active' : ''} ${affordable ? '' : 'card-poor'} ${usable ? '' : 'card-disabled'}`}
    disabled={disabled}
    aria-pressed={active}
    aria-label={`${def.name}. Costs ${def.cost} command. ${def.headline}. ${reason}`}
    title={`${def.name} · ${def.cost} command`}
    onClick={() => onSelect(index)}
  >
    <span className="card-cost" aria-hidden="true"><Zap size={11} />{def.cost}</span>
    <span className="card-art" aria-hidden="true"><CardIcon card={card} size={22} /></span>
    <span className="card-name">{def.name}</span>
    <span className="card-headline">{def.headline}</span>
    <span className="card-role">{ROLE_LABEL[card]}</span>
    <span className="card-tip" aria-hidden="true">
      <strong>{def.name} · {def.cost}</strong>
      <em>{def.rule}</em>
      <b>{reason}</b>
    </span>
  </button>
}

export function CommandTray({ state, color, surge, regen, locked, activeIndex, playable, gained, onSelect }: Props) {
  const hand = handOf(state, color)
  const upcoming = nextOf(state, color)
  const command = state.command[color]
  return <div className={`command-tray ${surge ? 'is-surge' : ''}`} aria-label="Command and tactic cards">
    <div className="command-meter">
      <div className="command-head">
        <span className="command-icon" aria-hidden="true"><Zap size={15} /></span>
        <span className="command-value" aria-hidden="true">{command}<small>/{MAX_COMMAND}</small></span>
        <span className="command-caption">Command</span>
        <span className="command-regen">+{regen} each turn</span>
        {surge && <span className="surge-badge">Surge</span>}
        {gained !== null && gained > 0 && <span className="command-gain" aria-hidden="true">+{gained}</span>}
        {command >= MAX_COMMAND && <span className="command-full">Full — spend it</span>}
      </div>
      <div className="command-pips" role="img" aria-label={`Command: ${command} of ${MAX_COMMAND}`}>
        {Array.from({ length: MAX_COMMAND }, (_, index) => <i key={index} className={index < command ? 'pip-filled' : ''} />)}
      </div>
    </div>
    <div className="card-row">
      <div className="next-card" aria-label={`Next card: ${CARDS[upcoming].name}`}>
        <span className="next-label">Next</span>
        <span className={`next-art role-${CARDS[upcoming].role}`} aria-hidden="true"><CardIcon card={upcoming} size={16} /></span>
        <span className="next-name">{CARDS[upcoming].name}</span>
      </div>
      <div className="card-hand" role="group" aria-label="Your tactic cards">
        {hand.map((card, index) => <Card
          key={`${card}-${index}`}
          card={card}
          index={index}
          state={state}
          color={color}
          playable={playable}
          locked={locked}
          active={activeIndex === index}
          onSelect={onSelect}
        />)}
      </div>
    </div>
  </div>
}
