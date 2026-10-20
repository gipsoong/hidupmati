# Hidup Mati

Browser-based 2.5D roguelike zombie survival, built with TypeScript and Three.js.

```sh
npm install
npm run dev     # local dev server
npm run build   # type-check and build to dist/
```

Controls: WASD to move, mouse to aim, hold left click to shoot, Esc to pause.

## Layout

- `src/game.ts` simulation: player, waves, zombie AI, bullets
- `src/flow.ts` BFS flow field the whole horde paths with
- `src/grid.ts` spatial hash for crowd separation and bullet hits
- `src/map.ts` tile map generation and collision
- `src/renderer.ts` Three.js scene; zombies, bullets and particles are instanced
- `src/hud.ts`, `src/input.ts`, `src/main.ts` DOM overlay, input and game loop
