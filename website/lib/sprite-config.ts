/** Shared sprite-sheet configuration for the Pluto mascot. */
export const spriteConfig = {
  columns: 9,
  frameU: 1 / 9,
  frameV: 1,
  walkFrameMs: 85,
  sitFrameMs: 170,
} as const;

/** Build a root-relative sprite URL for the static export. */
export function spriteUrl(filename: string): string {
  return `/${filename.replace(/^\//, "")}`;
}

/** Horizontal sprite-sheet offset for a frame, including the reversed-direction shift. */
export function frameOffset(
  frameIndex: number,
  direction: number,
  columns: number = spriteConfig.columns,
): number {
  const offset = (frameIndex % columns) / columns;
  return direction < 0 ? offset + 1 / columns : offset;
}
