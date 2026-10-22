import './style.css';
import { loadAssets } from './assets';
import { MAX_STEP } from './config';
import { Game, type Controls } from './game';
import { WEAPONS } from './weapons';
import { Hud } from './hud';
import { Input } from './input';
import { Renderer, SCREEN_RIGHT, SCREEN_UP } from './renderer';

type State = 'loading' | 'menu' | 'playing' | 'paused' | 'upgrade' | 'over';

const BEST_KEY = 'hidupmati.best';

const app = document.getElementById('app')!;
const screen = document.getElementById('screen')!;
const input = new Input(app);
const renderer = new Renderer(app);
const hud = new Hud();
const controls: Controls = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, firing: false, weapon: -1, build: false };

let game = new Game(Math.random() * 1e9);
let state: State = 'loading';

function loadBest(): { wave: number; kills: number } {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '') ?? { wave: 0, kills: 0 };
  } catch {
    return { wave: 0, kills: 0 };
  }
}

function saveBest(wave: number, kills: number) {
  const best = loadBest();
  if (wave > best.wave || (wave === best.wave && kills > best.kills)) {
    try { localStorage.setItem(BEST_KEY, JSON.stringify({ wave, kills })); } catch { /* storage unavailable */ }
  }
}

function showScreen(html: string) {
  screen.innerHTML = html;
  screen.classList.add('show');
}

function setState(next: State) {
  state = next;
  document.body.classList.toggle('playing', next === 'playing');
  if (next === 'playing') { screen.classList.remove('show'); return; }
  if (next === 'loading') {
    showScreen(`<h1>HIDUP<span>MATI</span></h1><p class="tag" id="progress">Loading 0%</p>`);
  } else if (next === 'menu') {
    const best = loadBest();
    showScreen(`
      <h1>HIDUP<span>MATI</span></h1>
      <p class="tag">Survive the horde. Every wave is worse.</p>
      <div class="controls">
        <div><b>WASD</b> move</div><div><b>Mouse</b> aim</div>
        <div><b>Hold click</b> shoot</div><div><b>E / right click</b> barricade</div>
        <div><b>1 2 3</b> switch weapon</div><div><b>Esc</b> pause</div>
      </div>
      ${best.wave ? `<p class="best">Best: wave ${best.wave}, ${best.kills} kills</p>` : ''}
      <button id="go">Click to start</button>`);
  } else if (next === 'upgrade') {
    const cards = (game.choices ?? []).map((u, i) => `
      <button class="card" data-i="${i}"><kbd>${i + 1}</kbd><b>${u.title}</b><span>${u.desc}</span></button>`).join('');
    showScreen(`
      <h1 class="sm">Wave ${game.wave} <span>cleared</span></h1>
      <p class="tag">Pick an upgrade</p>
      <div class="cards">${cards}</div>`);
  } else if (next === 'paused') {
    showScreen(`<h1>Paused</h1><button id="go">Click to resume</button>`);
  } else {
    saveBest(game.wave, game.kills);
    const best = loadBest();
    showScreen(`
      <h1 class="dead">You died</h1>
      <p class="tag">Reached wave ${game.wave} with ${game.kills} kills</p>
      <p class="best">Best: wave ${best.wave}, ${best.kills} kills</p>
      <button id="go">Click to try again</button>`);
  }
}

function pickUpgrade(i: number) {
  if (state !== 'upgrade' || !game.choices?.[i]) return;
  game.pickUpgrade(i);
  input.mouseDown = false;
  input.clearPresses();
  setState('playing');
}

screen.addEventListener('click', (e) => {
  if (state === 'loading') return;
  if (state === 'upgrade') {
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (card) pickUpgrade(Number(card.dataset.i));
    return;
  }
  if (state === 'over') {
    game = new Game(Math.random() * 1e9);
    renderer.setGame(game);
  }
  input.mouseDown = false;
  setState('playing');
});
window.addEventListener('blur', () => { if (state === 'playing') setState('paused'); });
window.addEventListener('keydown', (e) => {
  if (state !== 'upgrade') return;
  const i = Number(e.key) - 1;
  if (i >= 0 && i < 3) pickUpgrade(i);
});

const aim = { x: 0, z: 0 };
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state === 'playing' && (input.consume('Escape') || input.consume('KeyP'))) setState('paused');

  renderer.updateCamera(game, dt);
  if (renderer.screenToWorld(input.ndcX, input.ndcY, aim)) {
    controls.aimX = aim.x;
    controls.aimZ = aim.z;
  }
  const ax = input.axis();
  controls.moveX = ax.x * SCREEN_RIGHT.x + ax.y * SCREEN_UP.x;
  controls.moveZ = ax.x * SCREEN_RIGHT.z + ax.y * SCREEN_UP.z;
  controls.firing = input.mouseDown;
  controls.weapon = -1;
  for (let i = 0; i < WEAPONS.length; i++) if (input.consume(`Digit${i + 1}`)) controls.weapon = i;
  controls.build = input.consume('KeyE') || input.consume('Mouse2');

  if (state === 'playing') {
    // Variable timestep, split so no single step exceeds MAX_STEP.
    const steps = Math.ceil(dt / MAX_STEP);
    for (let i = 0; i < steps; i++) game.update(dt / steps, controls);
    if (game.over) setState('over');
    else if (game.choices) setState('upgrade');
  }

  if (state !== 'loading') {
    renderer.render(game, state === 'playing' ? dt : 0);
    hud.update(game, dt, input.screenX, input.screenY, state === 'playing');
    autoQuality(dt);
  }
  input.clearPresses();
  requestAnimationFrame(frame);
}

// Drop the expensive effects if the game can't hold ~45 fps for a few seconds.
let slowTime = 0;
/** `?hq` keeps full quality regardless of frame rate (for screenshots on slow machines). */
const FIXED_QUALITY = new URLSearchParams(location.search).has('hq');
function autoQuality(dt: number) {
  if (state !== 'playing' || renderer.quality === 'low' || FIXED_QUALITY) return;
  slowTime = dt > 1 / 45 ? slowTime + dt : Math.max(0, slowTime - dt * 0.5);
  if (slowTime > 3) renderer.setQuality('low');
}

setState('loading');
requestAnimationFrame(frame);
loadAssets((f) => {
  const el = document.getElementById('progress');
  if (el) el.textContent = `Loading ${Math.round(f * 100)}%`;
}).then((assets) => {
  renderer.init(assets);
  renderer.setGame(game);
  setState('menu');
}).catch((e) => {
  const el = document.getElementById('progress');
  if (el) el.textContent = `Couldn't load the game files: ${e instanceof Error ? e.message : e}`;
  console.error(e);
});

// Exposed for automated smoke tests.
(window as unknown as { __game: () => Game; __renderer: Renderer }).__game = () => game;
(window as unknown as { __renderer: Renderer }).__renderer = renderer;
