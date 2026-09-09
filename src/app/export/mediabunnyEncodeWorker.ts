/**
 * Compatibility entry for builds that referenced the pre-7.3F.9 worker name.
 * Production and compatibility imports now execute the same worker authority,
 * preventing codec, keyframe, color, and telemetry policy drift.
 */
import './videoEncoder.worker';

export {};
