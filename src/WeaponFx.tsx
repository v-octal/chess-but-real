import type { Weapon } from './battle'

type Point = { x: number; y: number }
type Props = { weapon: Weapon; from: Point; to: Point; stage: 'launch' | 'impact' | 'travel'; lethal: boolean; support: number }

const SPEED: Record<Weapon, number> = { spear: 0.24, lance: 0.3, bolt: 0.3, cannon: 0.3, beam: 0.3, sword: 0.26 }

function angle(from: Point, to: Point) {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI
}

function length(from: Point, to: Point) {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

export function WeaponFx({ weapon, from, to, stage, lethal, support }: Props) {
  const rotation = angle(from, to)
  const span = length(from, to)
  const path = `M ${from.x} ${from.y} L ${to.x} ${to.y}`
  const launching = stage === 'launch'
  const impact = <g className={`impact weapon-${weapon} ${lethal ? 'impact-lethal' : ''}`} transform={`translate(${to.x} ${to.y})`}>
    <circle className="impact-ring" r="36" />
    {weapon === 'cannon' && <><circle className="impact-smoke" r="22" /><circle className="impact-smoke impact-smoke-b" r="16" /></>}
    {weapon === 'bolt' && [0, 60, 120, 180, 240, 300].map(deg => <line key={deg} className="impact-spark" x1="0" y1="0" x2="0" y2="-30" transform={`rotate(${deg})`} />)}
    {weapon === 'beam' && <circle className="impact-flare" r="28" />}
    {(weapon === 'spear' || weapon === 'sword' || weapon === 'lance') && [-18, 0, 18].map(deg => <line key={deg} className="impact-slash" x1="-26" y1="0" x2="26" y2="0" transform={`rotate(${rotation + deg})`} />)}
    {support > 0 && <text className="impact-support" y="-50" textAnchor="middle">+{support} SUPPORT</text>}
  </g>

  if (weapon === 'spear') {
    const reach = Math.max(0, span - 34)
    const dx = Math.cos(rotation * Math.PI / 180) * reach
    const dy = Math.sin(rotation * Math.PI / 180) * reach
    return <g className="weapon-fx weapon-spear">
      {launching && <g transform={`translate(${from.x} ${from.y})`}><g className="spear-thrust" style={{ ['--dx' as string]: `${dx}px`, ['--dy' as string]: `${dy}px` }}>
        <g className="spear-body" transform={`rotate(${rotation})`}>
          <line className="spear-shaft" x1="0" y1="0" x2="48" y2="0" />
          <polygon className="spear-tip" points="48,-7 66,0 48,7" />
        </g>
      </g></g>}
      {!launching && impact}
    </g>
  }

  if (weapon === 'lance') {
    return <g className="weapon-fx weapon-lance">
      {launching && <g className="lance-charge">
        <line className="lance-trail" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
        <g className="lance-body">
          <animateMotion dur={`${SPEED.lance}s`} fill="freeze" path={path} rotate="auto" />
          <rect className="lance-shaft" x="-30" y="-4" width="52" height="8" rx="4" />
          <polygon className="lance-tip" points="22,-9 46,0 22,9" />
          <circle className="lance-guard" cx="-8" cy="0" r="9" />
        </g>
      </g>}
      {!launching && impact}
    </g>
  }

  if (weapon === 'bolt') {
    return <g className="weapon-fx weapon-bolt">
      {launching && <>
        <path className="bolt-arc" d={path} />
        <g className="bolt-core">
          <animateMotion dur={`${SPEED.bolt}s`} fill="freeze" path={path} />
          <circle className="bolt-glow" r="16" />
          <circle className="bolt-orb" r="8" />
          <circle className="bolt-spark" r="3" cx="-14" cy="6" />
          <circle className="bolt-spark" r="2.5" cx="-22" cy="-5" />
        </g>
      </>}
      {!launching && impact}
    </g>
  }

  if (weapon === 'cannon') {
    return <g className="weapon-fx weapon-cannon">
      {launching && <>
        <g className="cannon-muzzle" transform={`translate(${from.x} ${from.y}) rotate(${rotation})`}>
          <circle className="muzzle-flash" cx="36" cy="0" r="18" />
          <polygon className="muzzle-cone" points="30,-14 72,0 30,14" />
        </g>
        <g className="cannon-ball">
          <animateMotion dur={`${SPEED.cannon}s`} fill="freeze" path={path} />
          <circle className="cannon-shadow" r="11" cx="3" cy="3" />
          <circle className="cannon-shell" r="11" />
          <circle className="cannon-shine" r="3" cx="-4" cy="-4" />
        </g>
      </>}
      {!launching && impact}
    </g>
  }

  if (weapon === 'beam') {
    return <g className="weapon-fx weapon-beam">
      {launching && <g className="beam-group">
        <line className="beam-outer" x1={from.x} y1={from.y} x2={to.x} y2={to.y} pathLength="1" />
        <line className="beam-inner" x1={from.x} y1={from.y} x2={to.x} y2={to.y} pathLength="1" />
        <circle className="beam-origin" cx={from.x} cy={from.y} r="14" />
      </g>}
      {!launching && impact}
    </g>
  }

  return <g className="weapon-fx weapon-sword">
    {launching && <g transform={`translate(${from.x} ${from.y})`}><g className="sword-swing" style={{ ['--angle' as string]: `${rotation}deg` }}>
      <g className="sword-body">
        <rect className="sword-blade" x="18" y="-5" width="58" height="10" rx="2" />
        <polygon className="sword-point" points="76,-5 90,0 76,5" />
        <rect className="sword-guard" x="12" y="-14" width="8" height="28" rx="2" />
        <rect className="sword-grip" x="-6" y="-4" width="18" height="8" rx="3" />
      </g>
      <path className="sword-arc" d="M 60 -55 A 80 80 0 0 1 60 55" pathLength="1" />
    </g></g>}
    {!launching && impact}
  </g>
}
