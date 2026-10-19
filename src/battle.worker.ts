import { getBattleComputerMove, validateBattle } from './battleAi'
import type { BattleComputerMove } from './battleAi'
import type { BattleState } from './battle'

export type BattleRequest = { state: BattleState; level: number; requestId: number }
export type BattleResponse = { move: BattleComputerMove | null; requestId: number }

const worker = self as unknown as DedicatedWorkerGlobalScope

worker.onmessage = ({ data }: MessageEvent<unknown>) => {
  let requestId = 0
  let move: BattleComputerMove | null = null
  try {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const request = data as Partial<BattleRequest>
      if (typeof request.requestId === 'number' && Number.isFinite(request.requestId)) {
        requestId = request.requestId
        if (typeof request.level === 'number' && validateBattle(request.state)) {
          move = getBattleComputerMove(request.state, request.level)
        }
      }
    }
  } catch {
    move = null
  }
  worker.postMessage({ move, requestId } satisfies BattleResponse)
}
