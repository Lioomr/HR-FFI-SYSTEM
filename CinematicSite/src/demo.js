const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (value) => value * value * (3 - 2 * value);

export class DemoMode {
  constructor({ enabled, duration = 15, onReset, onState }) {
    this.enabled = enabled;
    this.duration = duration;
    this.onReset = onReset;
    this.onState = onState;
    this.playing = false;
    this.raf = 0;
    this.startedAt = 0;
    this.startY = 0;
    this.progress = 0;
    if (!enabled) return;
    document.documentElement.classList.add('is-demo');
    window.addEventListener('keydown', this.handleKey);
    window.addEventListener('wheel', this.handleManual, { passive: true });
    window.addEventListener('touchstart', this.handleManual, { passive: true });
  }

  handleKey = (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      this.toggle();
    }
    if (event.key.toLowerCase() === 'r') this.reset();
  };

  handleManual = () => this.pause();

  maxScroll() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    if (!this.enabled || this.playing) return;
    const max = this.maxScroll();
    this.progress = max ? clamp(window.scrollY / max) : 0;
    this.startY = window.scrollY;
    this.startedAt = performance.now() - this.progress * this.duration * 1000;
    this.playing = true;
    this.onState?.(true);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onState?.(false);
  }

  tick = (now) => {
    if (!this.playing) return;
    const elapsed = (now - this.startedAt) / (this.duration * 1000);
    const progress = clamp(elapsed);
    window.scrollTo(0, smooth(progress) * this.maxScroll());
    if (progress >= 1) {
      window.scrollTo(0, this.maxScroll());
      this.pause();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  reset() {
    this.pause();
    this.progress = 0;
    window.scrollTo(0, 0);
    this.onReset?.();
  }

  destroy() {
    this.pause();
    window.removeEventListener('keydown', this.handleKey);
    window.removeEventListener('wheel', this.handleManual);
    window.removeEventListener('touchstart', this.handleManual);
  }
}
