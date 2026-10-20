import { PLAYER_MAX_HP } from './config';
import type { Game } from './game';

const $ = (id: string) => document.getElementById(id)!;

/** DOM overlay. Only touches the DOM when a displayed value actually changes. */
export class Hud {
  private readonly hpFill = $('hp-fill');
  private readonly hpText = $('hp-text');
  private readonly wave = $('wave');
  private readonly left = $('left');
  private readonly kills = $('kills');
  private readonly banner = $('banner');
  private readonly bannerTitle = $('banner-title');
  private readonly bannerSub = $('banner-sub');
  private readonly stats = $('stats');
  private readonly crosshair = $('crosshair');
  private readonly vignette = $('vignette');
  private readonly cache = new Map<HTMLElement, string>();
  private bannerSeq = -1;
  private bannerTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;

  private set(el: HTMLElement, text: string) {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text);
    el.textContent = text;
  }

  update(game: Game, dt: number, mouseX: number, mouseY: number, playing: boolean): void {
    const hp = Math.ceil(game.player.hp);
    if (this.cache.get(this.hpFill) !== String(hp)) {
      this.cache.set(this.hpFill, String(hp));
      this.hpFill.style.width = `${(hp / PLAYER_MAX_HP) * 100}%`;
      this.hpFill.classList.toggle('low', hp <= 30);
      this.vignette.style.opacity = String(Math.max(0, (40 - hp) / 40) * 0.9);
    }
    this.set(this.hpText, `${hp}`);
    this.set(this.wave, game.wave ? `Wave ${game.wave}` : 'Wave -');
    this.set(this.left, `${game.zombiesLeft} left`);
    this.set(this.kills, `${game.kills} kills`);

    // Banners wait until play starts so they aren't missed behind the menu.
    if (playing && game.bannerSeq !== this.bannerSeq) {
      this.bannerSeq = game.bannerSeq;
      this.bannerTitle.textContent = game.bannerTitle;
      this.bannerSub.textContent = game.bannerSub;
      this.banner.classList.remove('show');
      void this.banner.offsetWidth; // restart the CSS animation
      this.banner.classList.add('show');
      this.bannerTimer = 2.5;
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }

    this.crosshair.style.transform = `translate(${mouseX}px, ${mouseY}px)`;

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.set(this.stats, `${Math.round(this.fpsFrames / this.fpsTime)} fps · ${game.zombies.n} zombies`);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }
}
