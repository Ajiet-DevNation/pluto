import * as THREE from "three";
import { frameOffset, spriteConfig, spriteUrl } from "@/lib/sprite-config";

/** Owned by one mounted canvas. Every GPU resource and browser subscription is disposed. */
export function createOrbit(canvas: HTMLCanvasElement, targetButton: HTMLButtonElement, onReady: (ready: boolean) => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setClearColor(0x0d0a1a, 0);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0d0a1a, 18, 42);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
  const world = new THREE.Group();
  world.rotation.z = .2;
  scene.add(world);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const geometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.push(value); return value; };
  const material = <T extends THREE.Material>(value: T): T => { materials.push(value); return value; };
  const orbit = (t: number) => new THREE.Vector3(7.5 * Math.cos(t), 0, 4.2 * Math.sin(t));
  const start = 2.3;
  const sweep = Math.PI * 1.8;
  const ringPoints = Array.from({ length: 240 }, (_, i) => orbit(i / 240 * Math.PI * 2));
  world.add(new THREE.LineLoop(geometry(new THREE.BufferGeometry().setFromPoints(ringPoints)), material(new THREE.LineBasicMaterial({ color: 0x665291, transparent: true, opacity: .55 }))));
  const trail = new THREE.Line(geometry(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 241 }, (_, i) => orbit(start - i / 240 * sweep)))), material(new THREE.LineBasicMaterial({ color: 0xc3afd9, transparent: true, opacity: .8 })));
  world.add(trail);
  const core = new THREE.Mesh(geometry(new THREE.IcosahedronGeometry(1.55, 1)), material(new THREE.MeshBasicMaterial({ color: 0x5b448c, wireframe: true, transparent: true, opacity: .65 })));
  world.add(core);
  world.add(new THREE.Mesh(geometry(new THREE.SphereGeometry(1.25, 24, 16)), material(new THREE.MeshBasicMaterial({ color: 0x140e2a }))));

  // Seeded scene composition keeps the same constellation across remounts.
  let seed = 721;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const rockGeometry = geometry(new THREE.DodecahedronGeometry(1, 0));
  const rockMaterial = material(new THREE.MeshBasicMaterial({ color: 0x786299 }));
  const rocks = Array.from({ length: 22 }, () => {
    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    const position = orbit(random() * Math.PI * 2);
    const spread = 1 + (random() - .5) * .35;
    rock.scale.setScalar(.06 + random() * .13);
    rock.position.set(position.x * spread, (random() - .5) * .8, position.z * spread);
    rock.rotation.set(random() * 3, random() * 3, random() * 3);
    world.add(rock);
    return rock;
  });
  const stopGeometry = geometry(new THREE.SphereGeometry(.12, 12, 8));
  const markers = Array.from({ length: 6 }, (_, i) => {
    const marker = new THREE.Mesh(stopGeometry, material(new THREE.MeshBasicMaterial({ color: 0x8b6bff })));
    marker.position.copy(orbit(start - i / 5 * sweep));
    world.add(marker);
    return marker;
  });
  const starPositions = new Float32Array(1200 * 3);
  for (let i = 0; i < 1200; i++) {
    const radius = 24 + random() * 24;
    const azimuth = random() * Math.PI * 2;
    const elevation = Math.acos(2 * random() - 1);
    starPositions.set([radius * Math.sin(elevation) * Math.cos(azimuth), radius * Math.cos(elevation), radius * Math.sin(elevation) * Math.sin(azimuth)], i * 3);
  }
  const stars = geometry(new THREE.BufferGeometry());
  stars.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(stars, material(new THREE.PointsMaterial({ color: 0xcfc3ee, size: .065, transparent: true, opacity: .65, fog: false }))));

  let disposed = false;
  let lost = false;
  let assetsLoaded = 0;
  let assetsFailed = false;
  let revealed = false;
  let frame = 0;
  let paused = false;
  let width = innerWidth;
  let height = innerHeight;
  let progress = 0;
  let destination = 0;
  let mouseX = 0;
  let mouseY = 0;
  let lastTime = 0;
  let elapsed = 0;
  let lastMove = 0;
  let previousX = 0;
  let direction = 1;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(pointer: fine)");
  const sections = [...document.querySelectorAll<HTMLElement>(".orbit-stop")];
  let centers: number[] = [];
  const loader = new THREE.TextureLoader();
  function sheet(url: string) {
    const texture = loader.load(url, () => {
      if (disposed) { texture.dispose(); return; }
      assetsLoaded++;
      wake();
    }, undefined, () => { assetsFailed = true; onReady(false); });
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(spriteConfig.frameU, spriteConfig.frameV);
    textures.push(texture);
    return texture;
  }
  const walk = sheet(spriteUrl("pluto-walk.png"));
  const sit = sheet(spriteUrl("pluto-sit.png"));
  const spriteMaterial = material(new THREE.SpriteMaterial({ map: walk, transparent: true, fog: false, depthTest: false }));
  const mascot = new THREE.Sprite(spriteMaterial);
  mascot.renderOrder = 10;
  world.add(mascot);
  const projected = new THREE.Vector3();

  function updateScroll() {
    if (centers.length < 2) return;
    let index = 0;
    while (index < centers.length - 2 && scrollY > centers[index + 1]) index++;
    destination = THREE.MathUtils.clamp((index + (scrollY - centers[index]) / Math.max(1, centers[index + 1] - centers[index])) / (centers.length - 1), 0, 1);
    wake();
  }
  function measure() {
    centers = sections.map(section => section.offsetTop + section.offsetHeight / 2 - innerHeight / 2);
    updateScroll();
  }
  function resize() {
    width = innerWidth;
    height = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, width < 800 ? 1.5 : 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    measure();
  }
  function pointer(event: PointerEvent) {
    if (!finePointer.matches || reduced.matches || paused) return;
    mouseX = event.clientX / width - .5;
    mouseY = event.clientY / height - .5;
  }
  function paint(now: number) {
    frame = 0;
    if (disposed || lost || document.hidden || assetsFailed) return;
    const still = paused || reduced.matches;
    const delta = Math.min((now - (lastTime || now)) / 1000, .05);
    lastTime = now;
    if (!still) elapsed += delta;
    progress = still ? destination : progress + (destination - progress) * (1 - Math.exp(-delta * 5));
    const moving = !still && Math.abs(destination - progress) > .0004;
    if (moving) lastMove = elapsed;
    const idle = !moving && elapsed - lastMove > .7;
    const position = orbit(start - progress * sweep);
    mascot.position.set(position.x, .9 + (still ? 0 : Math.sin(elapsed * 1.5) * .04), position.z);
    trail.geometry.setDrawRange(0, Math.max(1, Math.round(progress * 240) + 1));
    const azimuth = -1.2 + .4 * progress * sweep + (still ? 0 : mouseX * .12);
    const elevation = .5 + Math.sin(progress * Math.PI) * .12 - (still ? 0 : mouseY * .1);
    const distance = width < 800 ? 20 : 14.5;
    camera.position.set(Math.sin(azimuth) * distance * Math.cos(elevation), Math.sin(elevation) * distance, Math.cos(azimuth) * distance * Math.cos(elevation));
    camera.lookAt(0, 0, 0);
    camera.clearViewOffset();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    if (width < 800) {
      mascot.getWorldPosition(projected).project(camera);
      camera.setViewOffset(width, height, (projected.x * .5 + .5) * width - width * .58, (-projected.y * .5 + .5) * height - height * .19, width, height);
    } else {
      // Keep the interactive mascot in the open half of each alternating section.
      mascot.getWorldPosition(projected).project(camera);
      const desiredX = width * (.5 + .24 * Math.cos(progress * 5 * Math.PI));
      camera.setViewOffset(width, height, (projected.x * .5 + .5) * width - desiredX, (-projected.y * .5 + .5) * height - height * .55, width, height);
    }
    const resting = still || idle;
    spriteMaterial.map = resting ? sit : walk;
    const map = spriteMaterial.map;
    map.offset.x = still ? 0 : frameOffset(Math.floor(elapsed / (resting ? spriteConfig.sitFrameMs / 1000 : spriteConfig.walkFrameMs / 1000)), direction);
    map.repeat.x = direction / spriteConfig.columns;
    mascot.scale.set(1.8 * (resting ? 1.625 : 1), 1.8, 1);
    mascot.getWorldPosition(projected).project(camera);
    const screenX = (projected.x * .5 + .5) * width;
    const screenY = (-projected.y * .5 + .5) * height;
    if (moving && Math.abs(screenX - previousX) > .3) direction = screenX > previousX ? 1 : -1;
    previousX = screenX;
    targetButton.style.transform = `translate(${screenX - 50}px, ${screenY - 50}px)`;
    if (!still) {
      core.rotation.y = elapsed / 9;
      rocks.forEach((rock, index) => { rock.rotation.y += delta * .12 * (index % 3 + 1); });
    }
    const active = Math.round(progress * 5);
    markers.forEach((marker, index) => {
      marker.scale.setScalar(index === active ? 1.7 + (still ? 0 : Math.sin(elapsed * 3) * .15) : 1);
      marker.material.color.setHex(index === active ? 0xf2a7a0 : 0x8b6bff);
    });
    renderer.render(scene, camera);
    if (assetsLoaded === 2 && !revealed) { revealed = true; onReady(true); }
    if (!still) wake();
  }
  function wake() { if (!frame && !disposed && !lost && !document.hidden && !assetsFailed) frame = requestAnimationFrame(paint); }
  function visibility() { cancelAnimationFrame(frame); frame = 0; lastTime = 0; wake(); }
  function motionChange() { lastTime = 0; wake(); }
  function contextLost(event: Event) { event.preventDefault(); lost = true; revealed = false; cancelAnimationFrame(frame); frame = 0; onReady(false); }
  function contextRestored() { lost = false; lastTime = 0; wake(); }
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

  return {
    setPaused(value: boolean) { paused = value; lastTime = 0; wake(); },
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
      textures.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      geometries.forEach(item => item.dispose());
      renderer.dispose();
    },
  };
}
