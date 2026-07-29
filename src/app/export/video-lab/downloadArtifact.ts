import type { VideoLabArtifact } from './types';

export function downloadVideoLabArtifact(artifact: VideoLabArtifact): void {
  const url = URL.createObjectURL(artifact.blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.suggestedFilename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
