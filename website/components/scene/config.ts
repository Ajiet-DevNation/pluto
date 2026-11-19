import * as THREE from "three";

export const sceneConfig = {
  pathStart: -0.35,
  pathExtent: 1.43,
  pathSegments: 300,
  pathSides: 6,
  trailLength: 0.025,
  leadLength: 0.12,
  cameraHeight: 2.7,
  cameraDistance: 11,
  starCount: 420,
  rockCount: 16,
  maxPixelRatio: 2,
  frameInterval: 1000 / 30,
} as const;

export function positionAt(progress: number, target: THREE.Vector3): THREE.Vector3 {
  // A shallow entrance below the hero copy rejoins the original orbit at Pluto.
  const entrance = Math.max(0, Math.min(1, (progress + 0.29) / 0.04));
  const rise = Math.max(0, Math.min(1, (progress + 0.09) / 0.09));
  const smooth = (value: number) => value * value * (3 - 2 * value);
  const clearCopy =
    -2 * smooth(entrance) * (1 - smooth(Math.max(0, Math.min(1, (progress + 0.23) / 0.11))));
  const heroY =
    progress < -0.09 ? -0.65 - 1.45 * smooth(entrance) + clearCopy : -2.1 + 6.1 * smooth(rise);
  return target.set(
    progress * 70,
    progress < 0 ? heroY : 4 * Math.cos(progress * 2.5 * Math.PI),
    3.5 * Math.sin(progress * 2.2 * Math.PI),
  );
}
