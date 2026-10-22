# Hidup Mati

Browser-based 2.5D roguelike zombie survival, built with TypeScript and Three.js.

```sh
npm install
npm run dev     # local dev server
npm run build   # type-check and build to dist/
```

Controls: WASD to move, mouse to aim, hold left click to shoot, 1/2/3 to switch weapon, E or right click to barricade, Esc to pause.

Art comes from free CC0 and Boost-licensed packs (see `CREDITS.md`). The trimmed, web-sized files are committed
in `public/assets/`; to rebuild them from the original packs run `node tools/build-assets.mjs <packs-dir>`.

To publish as a claude.ai Artifact (which doesn't serve `.glb`), build with `VITE_MODEL_EXT=json npm run build`
and run `node tools/package-artifact.mjs dist <out-dir>`; it wraps each model as base64 in a .json file (the host blocks data: URIs).

Add `?hq` to the URL to keep full graphics quality on slow machines (otherwise ambient occlusion and
high-DPI rendering switch off when the frame rate drops below about 45 fps).

## Layout

- `src/game.ts` simulation: player, waves, zombie AI, bullets
- `src/flow.ts` BFS flow field the whole horde paths with
- `src/grid.ts` spatial hash for crowd separation and bullet hits
- `src/map.ts` tile map generation and collision
- `src/renderer.ts` Three.js scene, camera, lighting, post-processing, bullets and particles
- `src/render/crowd.ts` zombie horde: skeletal animations baked to a texture, one instanced draw call
- `src/render/avatar.ts` player character: layered jog/aim animation, outfit, pistol
- `src/render/world.ts` streets, sidewalks, brick buildings and props built from the tile map
- `src/assets.ts` loads models and textures
- `src/hud.ts`, `src/input.ts`, `src/main.ts` DOM overlay, input and game loop
