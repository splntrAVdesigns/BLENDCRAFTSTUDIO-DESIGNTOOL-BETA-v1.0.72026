import type { RecordingSessionState } from './types';

const ALLOWED_TRANSITIONS: Readonly<Record<RecordingSessionState, readonly RecordingSessionState[]>> = {
  idle: ['preparing'],
  preparing: ['recording', 'cancelled', 'failed'],
  recording: ['stopping', 'cancelled', 'failed'],
  stopping: ['finalizing', 'cancelled', 'failed'],
  finalizing: ['restoring', 'cancelled', 'failed'],
  restoring: ['completed', 'cancelled', 'failed'],
  completed: ['idle'],
  cancelled: ['idle'],
  failed: ['idle'],
};

export class RecordingSessionController {
  private currentState: RecordingSessionState = 'idle';

  get state(): RecordingSessionState {
    return this.currentState;
  }

  transition(nextState: RecordingSessionState): RecordingSessionState {
    if (nextState === this.currentState) return this.currentState;
    const allowed = ALLOWED_TRANSITIONS[this.currentState];
    if (!allowed.includes(nextState)) {
      throw new Error(`Invalid recording session transition: ${this.currentState} → ${nextState}.`);
    }
    this.currentState = nextState;
    return this.currentState;
  }

  reset(): void {
    if (this.currentState !== 'idle') this.transition('idle');
  }
}
