import {
  ArrowLeftRight, Bomb, Crosshair, Crown, Shield, Swords, TrendingUp, UserPlus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { CardId } from './tactics'

const ICONS: Record<CardId, LucideIcon> = {
  recruit: UserPlus,
  rally: TrendingUp,
  maneuver: ArrowLeftRight,
  fortify: Shield,
  expose: Crosshair,
  assault: Swords,
  bombard: Bomb,
  coronation: Crown,
}

export function CardIcon({ card, size = 20 }: { card: CardId; size?: number }) {
  const Icon = ICONS[card]
  return <Icon size={size} aria-hidden="true" />
}
