import * as THREE from "three";
import { frameOffset, spriteConfig, spriteUrl } from "@/lib/sprite-config";
import { positionAt, sceneConfig } from "./scene/config";
import { createPath } from "./scene/path";
import { createScenery } from "./scene/scenery";

/** Scroll-linked WebGL scene for the Orbit route. Owns every GPU resource and listener it creates. */
export function createOrbitShowcase(
  canvas: HTMLCanvasElement,
  guide: HTMLButtonElement,
  onReady: (ready: boolean) => void,
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0x0d0a1a, 0);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0d0a1a, 19, 53);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 110);
  scene.add(new THREE.AmbientLight(0xb4a8e0, 0.7));
  const sunlight = new THREE.DirectionalLight(0xddd1ff, 0.8);
  sunlight.position.set(-3, 8, 10);
  scene.add(sunlight);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(value: T): T => {
    if (value instanceof THREE.BufferGeometry) geometries.push(value);
    else materials.push(value);
    return value;
  };
  const material = track;

  let seed = 1259;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const path = createPath(scene, track);
  const scenery = createScenery(scene, track, random);

  const sections = [...document.querySelectorAll<HTMLElement>("[data-orbit-stop]")];
  const textNodes = sections.flatMap((section) => [
    ...section.querySelectorAll<HTMLElement>("h1, h2, h3, p, a, button"),
  ]);
  let visibleText: DOMRect[] = [];

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
    const texture = loader.load(
      url,
      () => {
        if (disposed) {
          texture.dispose();
          return;
        }
        spritesReady++;
        if (spritesReady === 2 && !spritesFailed) {
          sprite.visible = true;
          guide.dataset.sprite = "ready";
        }
        wake();
      },
      undefined,
      () => {
        spritesFailed = true;
        sprite.visible = false;
        delete guide.dataset.sprite;
        wake();
      },
    );
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(spriteConfig.frameU, spriteConfig.frameV);
    textures.push(texture);
    return texture;
  }
  const spritesAvailable =
    process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_PLUTO_SPRITES === "true";
  const walk = spritesAvailable ? sheet(spriteUrl("pluto-walk.png")) : null;
  const sit = spritesAvailable ? sheet(spriteUrl("pluto-sit.png")) : null;
  const spriteMaterial = material(
    new THREE.SpriteMaterial({
      map: walk ?? undefined,
      transparent: true,
      depthTest: false,
      fog: false,
    }),
  );
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.renderOrder = 10;
  sprite.visible = false;
  scene.add(sprite);
  const projected = new THREE.Vector3();
  const place = new THREE.Vector3();

  function measure() {
    centers = sections.map(
      (section) => section.offsetTop + section.offsetHeight / 2 - innerHeight / 2,
    );
    updateScroll();
  }
  function updateScroll() {
    if (centers.length < 2) return;
    visibleText =
      innerWidth < 800
        ? textNodes
            .map((node) => node.getBoundingClientRect())
            .filter((rect) => rect.bottom > 0 && rect.top < innerHeight)
        : [];
    const y = scrollY;
    if (Math.abs(y - previousScroll) > 1) direction = y > previousScroll ? 1 : -1;
    previousScroll = y;
    let index = 0;
    while (index < centers.length - 2 && y >= centers[index + 1]) index++;
    const span = Math.max(1, centers[index + 1] - centers[index]);
    destination = Math.max(
      0,
      Math.min(1, (index + (y - centers[index]) / span) / (sections.length - 1)),
    );
    wake();
  }
  function pointer(event: PointerEvent) {
    if (!finePointer.matches || reduced.matches) return;
    mouseX = event.clientX / innerWidth - 0.5;
    mouseY = event.clientY / innerHeight - 0.5;
  }
  function resize() {
    const width = innerWidth;
    const height = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, sceneConfig.maxPixelRatio));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    measure();
    wake();
  }
  function paint(now: number) {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    if (lastFrame && now - lastFrame < sceneConfig.frameInterval) {
      wake();
      return;
    }
    if (renderer.getPixelRatio() !== Math.min(devicePixelRatio || 1, sceneConfig.maxPixelRatio))
      resize();
    const still = reduced.matches;
    const delta = Math.min((now - (lastFrame || now)) / 1000, 0.05);
    lastFrame = now;
    if (!still) elapsed += delta;
    progress = still ? destination : progress + (destination - progress) * 0.075;
    const moving = !still && Math.abs(destination - progress) > 0.0004;
    if (moving) lastMove = now;
    const sitting = still || now - lastMove > 900;
    positionAt(progress, place);
    sprite.position.copy(place);
    sprite.position.y += 0.55 + (still ? 0 : Math.sin(elapsed * 1.2) * 0.045);
    path.update(progress);
    camera.position.set(
      place.x + 2.6 + (still ? 0 : mouseX * 0.35),
      place.y + sceneConfig.cameraHeight - (still ? 0 : mouseY * 0.25),
      place.z + sceneConfig.cameraDistance,
    );
    camera.lookAt(place.x, place.y, place.z - 0.7);
    camera.clearViewOffset();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    const width = innerWidth;
    const height = innerHeight;
    const askFocus = Math.max(0, 1 - Math.abs(progress * (sections.length - 1) - 3));
    const desiredX =
      width < 800 ? width * (0.5 + 0.3 * askFocus) : width * (0.73 + 0.11 * askFocus);
    const desiredY = width < 800 ? height * (0.23 - 0.07 * askFocus) : height * 0.5;
    place.project(camera);
    camera.setViewOffset(
      width,
      height,
      (place.x * 0.5 + 0.5) * width - desiredX,
      (-place.y * 0.5 + 0.5) * height - desiredY,
      width,
      height,
    );

    if (walk && sit) {
      const texture = sitting ? sit : walk;
      spriteMaterial.map = texture;
      texture.repeat.x = direction / spriteConfig.columns;
      texture.offset.x = still
        ? 0
        : frameOffset(
            Math.floor(
              elapsed /
                (sitting ? spriteConfig.sitFrameMs / 1000 : spriteConfig.walkFrameMs / 1000),
            ),
            direction,
          );
    }
    const mascotHeight = width < 800 ? 1.4 : 1.7;
    sprite.scale.set(mascotHeight * (sitting ? 1.625 : 1), mascotHeight, 1);
    sprite.getWorldPosition(projected).project(camera);
    const screenX = (projected.x * 0.5 + 0.5) * width;
    const screenY = (-projected.y * 0.5 + 0.5) * height;
    const textCollision =
      width < 800 &&
      visibleText.some(
        (rect) =>
          rect.left < screenX + 56 &&
          rect.right > screenX - 56 &&
          rect.top < screenY + 56 &&
          rect.bottom > screenY - 56,
      );
    sprite.visible = spritesReady === 2 && !spritesFailed && !textCollision;
    guide.style.visibility = textCollision ? "hidden" : "visible";
    guide.style.transform = `translate(${Math.round(Math.max(0, Math.min(width - 120, screenX - 60)))}px,${Math.round(Math.max(0, Math.min(height - 120, screenY - 60)))}px)`;

    if (!still) scenery.animate(delta, elapsed);
    renderer.render(scene, camera);
    if (!notified) {
      notified = true;
      onReady(true);
    }
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
  sections.forEach((section) => observer.observe(section));
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
      textures.forEach((texture) => texture.dispose());
      materials.forEach((item) => item.dispose());
      geometries.forEach((item) => item.dispose());
      renderer.dispose();
    },
  };
}
