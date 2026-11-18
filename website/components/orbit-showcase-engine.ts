import * as THREE from "three";
import { frameOffset, spriteConfig, spriteUrl } from "@/lib/sprite-config";

/** Scroll-linked WebGL scene for the Orbit route. Owns every GPU resource and listener it creates. */
export function createOrbitShowcase(canvas: HTMLCanvasElement, guide: HTMLButtonElement, onReady: (ready: boolean) => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0x0d0a1a, 0);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0d0a1a, 19, 53);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 110);
  scene.add(new THREE.AmbientLight(0xb4a8e0, .7));
  const sunlight = new THREE.DirectionalLight(0xddd1ff, .8);
  sunlight.position.set(-3, 8, 10);
  scene.add(sunlight);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const geometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.push(value); return value; };
  const material = <T extends THREE.Material>(value: T): T => { materials.push(value); return value; };

  let seed = 1259;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pos = (s: number) => new THREE.Vector3(s * 70, 4 * Math.cos(s * 2.5 * Math.PI), 3.5 * Math.sin(s * 2.2 * Math.PI));

  const start = -.08;
  const extent = 1.16;
  const segments = 480;
  const sides = 8;
  const points = Array.from({ length: segments + 1 }, (_, index) => pos(start + index / segments * extent));
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", .05);
  const tube = (radius: number, color: number, opacity: number) => {
    const mesh = new THREE.Mesh(
      geometry(new THREE.TubeGeometry(curve, segments, radius, sides, false)),
      material(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })),
    );
    scene.add(mesh);
    return mesh;
  };
  tube(.075, 0x4a6cf7, .09);
  tube(.022, 0x493d77, .83);
  const travelled = tube(.037, 0xc0aaff, .9);
  const startIndex = Math.round((0 - start) / extent * segments) * sides * 6;
  travelled.geometry.setDrawRange(startIndex, 0);

  const sections = [...document.querySelectorAll<HTMLElement>("[data-orbit-stop]")];
  const stops = Array.from({ length: sections.length }, (_, index) => {
    const marker = new THREE.Mesh(
      geometry(new THREE.SphereGeometry(.15, 12, 9)),
      material(new THREE.MeshBasicMaterial({ color: 0x8b6bff })),
    );
    marker.position.copy(pos(index / (sections.length - 1)));
    scene.add(marker);
    return marker;
  });

  const starArray = new Float32Array(1000 * 3);
  for (let index = 0; index < 1000; index++) starArray.set([-22 + random() * 114, -23 + random() * 46, -28 + random() * 22], index * 3);
  const starGeometry = geometry(new THREE.BufferGeometry());
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starArray, 3));
  scene.add(new THREE.Points(starGeometry, material(new THREE.PointsMaterial({ color: 0xd1c9e9, size: .065, opacity: .75, transparent: true, fog: false }))));

  const planetMaterials = [0x333055, 0x37345a, 0x2f3b61, 0x413658].map(color => material(new THREE.MeshLambertMaterial({ color, flatShading: true })));
  const planetGeometry = geometry(new THREE.IcosahedronGeometry(1, 2));
  const planetSettings = [[10, 9, -13, 1.15], [28, -8, -15, 1.75], [47, 9, -12, 1.1], [65, -7, -14, 1.4]];
  const planets = planetSettings.map(([x, y, z, size], index) => {
    const planet = new THREE.Mesh(planetGeometry, planetMaterials[index]);
    planet.position.set(x, y, z);
    planet.scale.setScalar(size);
    scene.add(planet);
    if (index === 1) {
      const ring = new THREE.Mesh(
        geometry(new THREE.TorusGeometry(size * 1.6, .04, 6, 80)),
        material(new THREE.MeshBasicMaterial({ color: 0x77689f, opacity: .45, transparent: true })),
      );
      ring.position.copy(planet.position);
      ring.rotation.x = 1.2;
      ring.rotation.y = .25;
      scene.add(ring);
    }
    return planet;
  });

  const rockGeometry = geometry(new THREE.DodecahedronGeometry(1, 0));
  const rockMaterial = material(new THREE.MeshLambertMaterial({ color: 0x48405f, flatShading: true }));
  const rocks = Array.from({ length: 45 }, () => {
    const scale = random() * 1.14 - .07;
    const base = pos(scale);
    const mesh = new THREE.Mesh(rockGeometry, rockMaterial);
    mesh.position.set(base.x + (random() - .5) * 5, base.y + (random() - .5) * 7, base.z - 2 - random() * 9);
    mesh.scale.setScalar(.06 + random() * .18);
    mesh.rotation.set(random() * 3, random() * 3, random() * 3);
    scene.add(mesh);
    return { mesh, baseY: mesh.position.y, phase: random() * 6.28 };
  });

  let disposed = false;
  let lost = false;
  let spritesReady = 0;
  let spritesFailed = false;
  let notified = false;
  let frame = 0;
  let lastFrame = 0;
  let elapsed = 0;
  let progress = 0;
  let destination = 0;
  let direction = 1;
  let previousScroll = scrollY;
  let mouseX = 0;
  let mouseY = 0;
  let lastMove = 0;
  let centers: number[] = [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(pointer: fine)");
  const loader = new THREE.TextureLoader();

  function sheet(url: string) {
    const texture = loader.load(url, () => {
      if (disposed) { texture.dispose(); return; }
      spritesReady++;
      if (spritesReady === 2 && !spritesFailed) {
        sprite.visible = true;
        guide.dataset.sprite = "ready";
      }
      wake();
    }, undefined, () => {
      spritesFailed = true;
      sprite.visible = false;
      delete guide.dataset.sprite;
      wake();
    });
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(spriteConfig.frameU, spriteConfig.frameV);
    textures.push(texture);
    return texture;
  }
  const walk = sheet(spriteUrl("pluto-walk.png"));
  const sit = sheet(spriteUrl("pluto-sit.png"));
  const spriteMaterial = material(new THREE.SpriteMaterial({ map: walk, transparent: true, depthTest: false, fog: false }));
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.renderOrder = 10;
  sprite.visible = false;
  scene.add(sprite);
  const projected = new THREE.Vector3();

  function measure() {
    centers = sections.map(section => section.offsetTop + section.offsetHeight / 2 - innerHeight / 2);
    updateScroll();
  }
  function updateScroll() {
    if (centers.length < 2) return;
    const y = scrollY;
    if (Math.abs(y - previousScroll) > 1) direction = y > previousScroll ? 1 : -1;
    previousScroll = y;
    let index = 0;
    while (index < centers.length - 2 && y >= centers[index + 1]) index++;
    const span = Math.max(1, centers[index + 1] - centers[index]);
    destination = Math.max(0, Math.min(1, (index + (y - centers[index]) / span) / (sections.length - 1)));
    wake();
  }
  function pointer(event: PointerEvent) {
    if (!finePointer.matches || reduced.matches) return;
    mouseX = event.clientX / innerWidth - .5;
    mouseY = event.clientY / innerHeight - .5;
  }
  function resize() {
    const width = innerWidth;
    const height = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    measure();
    wake();
  }
  function paint(now: number) {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    const still = reduced.matches;
    const delta = Math.min((now - (lastFrame || now)) / 1000, .05);
    lastFrame = now;
    if (!still) elapsed += delta;
    progress = still ? destination : progress + (destination - progress) * .075;
    const moving = !still && Math.abs(destination - progress) > .0004;
    if (moving) lastMove = now;
    const sitting = still || now - lastMove > 900;
    const place = pos(progress);
    sprite.position.copy(place);
    sprite.position.y += .85 + (still ? 0 : Math.sin(elapsed * 1.2) * .045);
    const reach = Math.round(((progress - start) / extent) * segments) * sides * 6;
    travelled.geometry.setDrawRange(startIndex, Math.max(0, reach - startIndex));
    camera.position.set(place.x + 2.6 + (still ? 0 : mouseX * .35), place.y + 2.7 - (still ? 0 : mouseY * .25), place.z + 11);
    camera.lookAt(place.x, place.y, place.z - .7);
    camera.clearViewOffset();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    const width = innerWidth;
    const height = innerHeight;
    const desiredX = width < 800 ? width * .5 : width * .73;
    const desiredY = width < 800 ? height * .23 : height * .5;
    place.project(camera);
    camera.setViewOffset(width, height, (place.x * .5 + .5) * width - desiredX, (-place.y * .5 + .5) * height - desiredY, width, height);

    const texture = sitting ? sit : walk;
    spriteMaterial.map = texture;
    texture.repeat.x = direction / spriteConfig.columns;
    texture.offset.x = still ? 0 : frameOffset(Math.floor(elapsed / (sitting ? spriteConfig.sitFrameMs / 1000 : spriteConfig.walkFrameMs / 1000)), direction);
    const mascotHeight = width < 800 ? 1.4 : 1.7;
    sprite.scale.set(mascotHeight * (sitting ? 1.625 : 1), mascotHeight, 1);
    sprite.getWorldPosition(projected).project(camera);
    const screenX = (projected.x * .5 + .5) * width;
    const screenY = (-projected.y * .5 + .5) * height;
    guide.style.transform = `translate(${Math.round(screenX - 60)}px,${Math.round(screenY - 60)}px)`;

    if (!still) {
      planets.forEach((planet, index) => { planet.rotation.y += delta * (.035 + index * .01); });
      rocks.forEach(({ mesh, baseY, phase }, index) => {
        mesh.position.y = baseY + Math.sin(elapsed * .3 + phase) * .14;
        mesh.rotation.y += delta * .045 * (index % 3 + 1);
      });
    }
    const active = Math.round(progress * (stops.length - 1));
    stops.forEach((marker, index) => {
      marker.material.color.setHex(index === active ? 0xf2a7a0 : 0x8b6bff);
      marker.scale.setScalar(index === active ? 1.55 + (still ? 0 : Math.sin(elapsed * 2) * .12) : 1);
    });
    renderer.render(scene, camera);
    if (!notified) { notified = true; onReady(true); }
    if (!still) wake();
  }
  function wake() {
    if (frame || disposed || lost || document.hidden) return;
    frame = requestAnimationFrame(paint);
  }
  function visibility() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    wake();
  }
  function motionChange() {
    lastFrame = 0;
    wake();
  }
  function contextLost(event: Event) {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    frame = 0;
    onReady(false);
  }
  function contextRestored() {
    lost = false;
    lastFrame = 0;
    wake();
  }

  addEventListener("scroll", updateScroll, { passive: true });
  addEventListener("resize", resize);
  addEventListener("pointermove", pointer, { passive: true });
  document.addEventListener("visibilitychange", visibility);
  reduced.addEventListener("change", motionChange);
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  const observer = new ResizeObserver(measure);
  sections.forEach(section => observer.observe(section));
  resize();
  progress = destination;
  wake();

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      removeEventListener("scroll", updateScroll);
      removeEventListener("resize", resize);
      removeEventListener("pointermove", pointer);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", motionChange);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      textures.forEach(texture => texture.dispose());
      materials.forEach(item => item.dispose());
      geometries.forEach(item => item.dispose());
      renderer.dispose();
    },
  };
}
