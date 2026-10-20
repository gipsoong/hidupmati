import './style.css';
import { MAX_STEP } from './config';
import { Game, type Controls } from './game';
import { Hud } from './hud';
import { Input } from './input';
import { Renderer, SCREEN_RIGHT, SCREEN_UP } from './renderer';

type State = 'menu' | 'playing' | 'paused' | 'over';

const BEST_KEY = 'hidupmati.best';

const app = document.getElementById('app')!;
const screen = document.getElementById('screen')!;
const input = new Input(app);
const renderer = new Renderer(app);
const hud = new Hud();
const controls: Controls = { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, firing: false };

let game = new Game(Math.random() * 1e9);
renderer.setGame(game);
let state: State = 'menu';

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
  if (next === 'menu') {
    const best = loadBest();
    showScreen(`
      <h1>HIDUP<span>MATI</span></h1>
      <p class="tag">Survive the horde. Every wave is worse.</p>
      <div class="controls">
        <div><b>WASD</b> move</div><div><b>Mouse</b> aim</div>
        <div><b>Hold click</b> shoot</div><div><b>Esc</b> pause</div>
      </div>
      ${best.wave ? `<p class="best">Best: wave ${best.wave}, ${best.kills} kills</p>` : ''}
      <button id="go">Click to start</button>`);
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

screen.addEventListener('click', () => {
  if (state === 'over') {
    game = new Game(Math.random() * 1e9);
    renderer.setGame(game);
  }
  input.mouseDown = false;
  setState('playing');
});
window.addEventListener('blur', () => { if (state === 'playing') setState('paused'); });

const aim = { x: 0, z: 0 };
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (state === 'playing' && (input.consume('Escape') || input.consume('KeyP'))) setState('paused');
  input.clearPresses();

  renderer.updateCamera(game, dt);
  if (renderer.screenToWorld(input.ndcX, input.ndcY, aim)) {
    controls.aimX = aim.x;
    controls.aimZ = aim.z;
  }
  const ax = input.axis();
  controls.moveX = ax.x * SCREEN_RIGHT.x + ax.y * SCREEN_UP.x;
  controls.moveZ = ax.x * SCREEN_RIGHT.z + ax.y * SCREEN_UP.z;
  controls.firing = input.mouseDown;

  if (state === 'playing') {
    // Variable timestep, split so no single step exceeds MAX_STEP.
    const steps = Math.ceil(dt / MAX_STEP);
    for (let i = 0; i < steps; i++) game.update(dt / steps, controls);
    if (game.over) setState('over');
  }

  renderer.render(game);
  hud.update(game, dt, input.screenX, input.screenY, state === 'playing');
  requestAnimationFrame(frame);
}

setState('menu');
requestAnimationFrame(frame);

// Exposed for automated smoke tests.
(window as unknown as { __game: () => Game }).__game = () => game;
