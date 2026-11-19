import * as THREE from "three";
import { positionAt, sceneConfig } from "./config";

type Track = <T extends THREE.BufferGeometry | THREE.Material>(resource: T) => T;

export function createPath(scene: THREE.Scene, track: Track) {
  const { pathStart, pathExtent, pathSegments, pathSides, trailLength, leadLength } = sceneConfig;
  const points = Array.from({ length: pathSegments + 1 }, (_, i) =>
    positionAt(pathStart + (i / pathSegments) * pathExtent, new THREE.Vector3()),
  );
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.05);

  function tube(radius: number, color: number, opacity: number) {
    const mesh = new THREE.Mesh(
      track(new THREE.TubeGeometry(curve, pathSegments, radius, pathSides, false)),
      track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })),
    );
    scene.add(mesh);
    return mesh;
  }

  const glow = tube(0.075, 0x4a6cf7, 0.05);
  const line = tube(0.022, 0x493d77, 0.5);
  const travelled = tube(0.037, 0xc0aaff, 0.8);
  const indicesPerSegment = pathSides * 6;

  return {
    update(progress: number, commandFocus = 0) {
      const shortTrail = trailLength * (1 - 0.72 * commandFocus);
      // Reveal the full off-screen entrance at the hero, then return to the
      // normal short trail before the next orbit station.
      const reveal = Math.max(0, 1 - progress / 0.1);
      const first = pathStart * reveal + (progress - shortTrail) * (1 - reveal);
      const last = Math.min(pathStart + pathExtent, progress + leadLength);
      const from =
        Math.round(((first - pathStart) / pathExtent) * pathSegments) * indicesPerSegment;
      const to = Math.round(((last - pathStart) / pathExtent) * pathSegments) * indicesPerSegment;
      const current =
        Math.round(((progress - pathStart) / pathExtent) * pathSegments) * indicesPerSegment;
      glow.geometry.setDrawRange(from, Math.max(0, to - from));
      line.geometry.setDrawRange(from, Math.max(0, to - from));
      travelled.geometry.setDrawRange(from, Math.max(0, current - from));
    },
  };
}
