import * as THREE from "three";

export const sceneConfig = {
  pathStart: -0.08,
  pathExtent: 1.16,
  pathSegments: 240,
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
  return target.set(
    progress * 70,
    4 * Math.cos(progress * 2.5 * Math.PI),
    3.5 * Math.sin(progress * 2.2 * Math.PI),
  );
}
