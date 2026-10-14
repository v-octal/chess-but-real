import { getComputerMove } from './engine'
import type { ComputerMove } from './engine'

export type EngineRequest = {
  fen: string
  level: number
  requestId: string | number
}

export type EngineResponse = {
  move: ComputerMove | null
  fen: string
  requestId: string | number
  error?: string
}

const worker = self as unknown as DedicatedWorkerGlobalScope

worker.onmessage = ({ data }: MessageEvent<EngineRequest>) => {
  const { fen, level, requestId } = data
  let response: EngineResponse

  try {
    response = { move: getComputerMove(fen, level), fen, requestId }
  } catch (error) {
    response = {
      move: null,
      fen,
      requestId,
      error: error instanceof Error ? error.message : 'Unable to calculate a move',
    }
  }

  worker.postMessage(response)
}
