# BLENDCRAFT Phase 7.3F.3 Patch Manifest

## Changed
- `src/app/shaders/gradientShaders.ts`
  - Blob: removed unstable segmented twist from metaball coordinates and guarded scale division.
  - Wave: removed four-tap AA across wrapped `fract()` boundaries.
- `src/app/components/controls/VideoExportLabPanel.tsx`
  - Updated deployed proof identity to Phase 7.3F.3.
- `package.json`
  - Version and Phase 7.3F.3 contract command.

## Added
- `tests/exportPhase73F3Contracts.test.ts`
- `docs/PHASE_7.3F.3_VERCEL_SHADER_RECOVERY_AND_PROOF.md`
- `PATCH_MANIFEST_PHASE_7.3F.3.md`

## Intentionally unchanged
- Production PNG export
- Production WebM/MP4 routing and encoder drain logic
- Loop Lock and duration planning
- `src/app/utils/exportUtils.ts`
