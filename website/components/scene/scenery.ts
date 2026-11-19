import * as THREE from "three";
import { positionAt, sceneConfig } from "./config";

type Track = <T extends THREE.BufferGeometry | THREE.Material>(resource: T) => T;

export function createScenery(scene: THREE.Scene, track: Track, random: () => number) {
  const stars = new Float32Array(sceneConfig.starCount * 3);
  for (let index = 0; index < sceneConfig.starCount; index++) {
    stars.set([-22 + random() * 114, -23 + random() * 46, -28 + random() * 22], index * 3);
  }
  const starGeometry = track(new THREE.BufferGeometry());
  starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  scene.add(
    new THREE.Points(
      starGeometry,
      track(
        new THREE.PointsMaterial({
          color: 0xd1c9e9,
          size: 0.065,
          opacity: 0.55,
          transparent: true,
          fog: false,
        }),
      ),
    ),
  );

  const planetMaterials = [0x333055, 0x37345a, 0x2f3b61, 0x413658].map((color) =>
    track(new THREE.MeshLambertMaterial({ color, flatShading: true })),
  );
  const planetGeometry = track(new THREE.IcosahedronGeometry(1, 2));
  const planets = [
    [10, 9, -13, 1.15],
    [28, -8, -15, 1.75],
    [47, 9, -12, 1.1],
    [65, -7, -14, 1.4],
  ].map(([x, y, z, size], index) => {
    const planet = new THREE.Mesh(planetGeometry, planetMaterials[index]);
    planet.position.set(x, y, z);
    planet.scale.setScalar(size);
    scene.add(planet);
    if (index === 1) {
      const ring = new THREE.Mesh(
        track(new THREE.TorusGeometry(size * 1.6, 0.04, 6, 80)),
        track(new THREE.MeshBasicMaterial({ color: 0x77689f, opacity: 0.45, transparent: true })),
      );
      ring.position.copy(planet.position);
      ring.rotation.x = 1.2;
      ring.rotation.y = 0.25;
      scene.add(ring);
    }
    return planet;
  });

  const rockGeometry = track(new THREE.DodecahedronGeometry(1, 0));
  const rockMaterial = track(new THREE.MeshLambertMaterial({ color: 0x48405f, flatShading: true }));
  const rocks = Array.from({ length: sceneConfig.rockCount }, () => {
    const scale = random() * 1.14 - 0.07;
    const base = positionAt(scale, new THREE.Vector3());
    const mesh = new THREE.Mesh(rockGeometry, rockMaterial);
    mesh.position.set(
      base.x + (random() - 0.5) * 5,
      base.y + (random() - 0.5) * 7,
      base.z - 2 - random() * 9,
    );
    mesh.scale.setScalar(0.06 + random() * 0.18);
    mesh.rotation.set(random() * 3, random() * 3, random() * 3);
    scene.add(mesh);
    return { mesh, baseY: mesh.position.y, phase: random() * 6.28 };
  });

  return {
    animate(delta: number, elapsed: number) {
      planets.forEach((planet, index) => {
        planet.rotation.y += delta * (0.035 + index * 0.01);
      });
      rocks.forEach(({ mesh, baseY, phase }, index) => {
        mesh.position.y = baseY + Math.sin(elapsed * 0.3 + phase) * 0.14;
        mesh.rotation.y += delta * 0.045 * ((index % 3) + 1);
      });
    },
  };
}
