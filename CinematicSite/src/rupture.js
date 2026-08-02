const TAU = Math.PI * 2;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const easeOut = (value) => 1 - (1 - value) ** 3;

const hash = (index, salt) => {
  const value = Math.sin(index * 91.73 + salt * 47.21) * 43758.5453;
  return value - Math.floor(value);
};

/**
 * A reversible, deterministic intervention field. Its state is derived only from
 * scroll progress: no clock, no random source and no pointer influence.
 */
export class RuptureField {
  constructor(canvas, reducedMotion) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.reducedMotion = reducedMotion;
    this.progress = 0;
    this.active = false;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.particles = [];
    this.resize();
    window.addEventListener('resize', this.resize, { passive: true });
  }

  resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const areaScale = clamp((this.width * this.height) / (1440 * 900), 0.45, 1.15);
    const count = this.reducedMotion ? 0 : Math.round(96 * areaScale);
    this.particles = Array.from({ length: count }, (_, index) => ({
      angle: hash(index, 1) * TAU,
      radius: 18 + hash(index, 2) * Math.min(this.width, this.height) * 0.3,
      thickness: 0.6 + hash(index, 3) * 2.8,
      drift: (hash(index, 4) - 0.5) * 46,
      alpha: 0.22 + hash(index, 5) * 0.68,
      orange: hash(index, 6) > 0.71,
      link: hash(index, 7) > 0.63,
    }));
    this.draw();
  };

  setActive(active) {
    this.active = active && !this.reducedMotion;
    if (this.active) this.draw();
  }

  setProgress(progress) {
    this.progress = clamp(progress);
    if (this.active) this.draw();
  }

  draw() {
    const { ctx, width, height, progress } = this;
    ctx.clearRect(0, 0, width, height);
    if (this.reducedMotion || progress < 0.1) return;

    const burst = easeOut(clamp((progress - 0.13) / 0.38));
    const network = clamp((progress - 0.38) / 0.28) * (1 - clamp((progress - 0.82) / 0.15));
    const settle = clamp((progress - 0.72) / 0.24);
    const originX = width * 0.476;
    const originY = height * 0.5;
    const points = [];

    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const distance = particle.radius * burst * (1 - settle * 0.47);
      const x = originX + Math.cos(particle.angle) * distance;
      const y = originY + Math.sin(particle.angle) * distance + particle.drift * burst;
      points.push({ x, y, link: particle.link });

      const alpha = particle.alpha * (0.2 + burst * 0.8) * (1 - settle * 0.55);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(particle.angle + Math.PI / 4);
      ctx.fillStyle = particle.orange
        ? `rgba(246,130,31,${alpha})`
        : `rgba(229,223,212,${alpha * 0.76})`;
      ctx.fillRect(-particle.thickness * 1.9, -particle.thickness * 0.48, particle.thickness * 3.8, particle.thickness * 0.96);
      ctx.restore();
    }

    if (network > 0.01) {
      ctx.strokeStyle = `rgba(246,130,31,${network * 0.28})`;
      ctx.lineWidth = 0.7;
      for (let a = 0; a < points.length; a += 1) {
        if (!points[a].link) continue;
        for (let b = a + 1; b < points.length; b += 1) {
          if (!points[b].link) continue;
          const distance = Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
          if (distance < 92) {
            ctx.globalAlpha = network * (1 - distance / 92);
            ctx.beginPath();
            ctx.moveTo(points[a].x, points[a].y);
            ctx.lineTo(points[b].x, points[b].y);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    const core = clamp((progress - 0.16) / 0.2) * (1 - settle * 0.6);
    if (core > 0) {
      ctx.strokeStyle = `rgba(246,130,31,${core * 0.45})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(originX, originY, 18 + burst * Math.min(width, height) * 0.15, 0, TAU);
      ctx.stroke();
    }
  }

  reset() {
    this.progress = 0;
    this.draw();
  }

  destroy() {
    window.removeEventListener('resize', this.resize);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}
