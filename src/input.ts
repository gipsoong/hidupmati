/** Raw keyboard and mouse state. */
export class Input {
  readonly keys = new Set<string>();
  mouseDown = false;
  /** Pointer position in normalised device coordinates (-1..1). */
  ndcX = 0;
  ndcY = 0;
  screenX = window.innerWidth / 2;
  screenY = window.innerHeight / 2;
  private pressed = new Set<string>();

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    window.addEventListener('pointermove', (e) => {
      this.screenX = e.clientX;
      this.screenY = e.clientY;
      this.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      this.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** True once per key press. */
  consume(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** Screen-relative movement: x = right, y = up. */
  axis(): { x: number; y: number } {
    const k = this.keys;
    return {
      x: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      y: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
    };
  }

  clearPresses(): void {
    this.pressed.clear();
  }
}
