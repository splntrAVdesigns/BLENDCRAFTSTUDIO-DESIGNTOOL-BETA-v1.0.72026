// Central export point for all custom hooks
export { useGradientState } from './useGradientState';
export { usePanelState } from './usePanelState';
export { useKeyboardShortcuts } from './useKeyboardShortcuts';
export { useHistory } from './useHistory';
export { useCustomPresets } from './useCustomPresets';
export { useDebounce } from './useDebounce';
// useThrottle/useThrottledValue/useThrottledState removed (Sprint: slider-lag
// hardening) — confirmed zero call sites app-wide. The RAF-throttle problem
// it was meant to solve for sliders is instead handled by the local-state +
// onValueCommit pattern already proven in GradientControls/EffectsControls,
// now also applied to ColorStopsSection and LayerPanel's opacity slider.
export { useLayerAnimations, calculateAnimationOffset, detectCycleCompletion, estimateCycleTime } from './useLayerAnimations';
// useRecording removed — RecordingPanel retired (Sprint A cleanup)
export { useUnsavedChanges, useStateTracker } from './useUnsavedChanges';
export { useTutorial } from './useTutorial';
export { useServiceWorker, useOnlineStatus } from './useServiceWorker';
export { useAutoSave } from './useAutoSave';
export type { KeyboardShortcuts } from './useKeyboardShortcuts';
export type { CustomPreset } from './useCustomPresets';