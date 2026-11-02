/**
 * 录音状态机 —— 显式定义状态流转，避免资源释放不干净。
 *
 * IDLE → PREPARING → RECORDING ⇄ PAUSED → STOPPING → FINISHED
 * 任何状态都可能进入 ERROR；ERROR 只允许回到 IDLE（RESET）。
 */

export type RecorderState =
  | 'IDLE'
  | 'PREPARING'
  | 'RECORDING'
  | 'PAUSED'
  | 'STOPPING'
  | 'FINISHED'
  | 'ERROR'

export type RecorderEvent =
  | 'PREPARE' // IDLE -> PREPARING
  | 'READY' // PREPARING -> RECORDING
  | 'PAUSE' // RECORDING -> PAUSED
  | 'RESUME' // PAUSED -> RECORDING
  | 'STOP' // RECORDING/PAUSED -> STOPPING
  | 'DONE' // STOPPING -> FINISHED
  | 'FAIL' // any -> ERROR
  | 'RESET' // FINISHED/ERROR -> IDLE

const TRANSITIONS: Record<RecorderState, Partial<Record<RecorderEvent, RecorderState>>> = {
  IDLE: { PREPARE: 'PREPARING', FAIL: 'ERROR' },
  PREPARING: { READY: 'RECORDING', FAIL: 'ERROR', STOP: 'STOPPING' },
  RECORDING: { PAUSE: 'PAUSED', STOP: 'STOPPING', FAIL: 'ERROR' },
  PAUSED: { RESUME: 'RECORDING', STOP: 'STOPPING', FAIL: 'ERROR' },
  STOPPING: { DONE: 'FINISHED', FAIL: 'ERROR' },
  FINISHED: { RESET: 'IDLE' },
  ERROR: { RESET: 'IDLE', PREPARE: 'PREPARING' }
}

/** 返回下一个状态；非法流转返回 null。 */
export function transition(state: RecorderState, event: RecorderEvent): RecorderState | null {
  return TRANSITIONS[state][event] ?? null
}

/** 该状态下是否持有活跃的采集资源（需要清理）。 */
export function holdsResources(state: RecorderState): boolean {
  return state === 'PREPARING' || state === 'RECORDING' || state === 'PAUSED' || state === 'STOPPING'
}

export function isActive(state: RecorderState): boolean {
  return state === 'RECORDING' || state === 'PAUSED'
}
