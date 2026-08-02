const HOLD_IN = 0.08;
const HOLD_OUT = 0.92;
const DEFAULT_FPS = 24;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const mapVideoProgress = (progress) => {
  if (progress <= HOLD_IN) return 0;
  if (progress >= HOLD_OUT) return 1;
  return (progress - HOLD_IN) / (HOLD_OUT - HOLD_IN);
};

/**
 * A paused, metadata-duration-driven scroll scrubber. The video clock never runs on its own;
 * ScrollTrigger supplies the one state value and this controller resolves it to a frame.
 */
export class ScrubController {
  constructor(video, { onReady, onError } = {}) {
    this.video = video;
    this.onReady = onReady;
    this.onError = onError;
    this.progress = 0;
    this.targetTime = 0;
    this.duration = 0;
    this.finalFrame = 0;
    this.framePending = false;
    this.ready = false;
    this.active = false;
    this.failed = false;
    this.presented = false;
    this.frameRate = Number(video.dataset.fps) || DEFAULT_FPS;

    this.video.pause();
    this.video.addEventListener('loadedmetadata', this.handleMetadata);
    this.video.addEventListener('loadeddata', this.handleLoadedData);
    this.video.addEventListener('error', this.handleError, { once: true });

    if (this.video.readyState >= HTMLMediaElement.HAVE_METADATA) this.handleMetadata();
    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) this.handleLoadedData();
  }

  handleMetadata = () => {
    const { duration } = this.video;
    this.ready = Number.isFinite(duration) && duration > 0;
    if (!this.ready) return;

    this.duration = duration;
    // Keep the source's true final decoded frame available instead of guessing a fixed end time.
    this.finalFrame = Math.max(0, duration - 1 / this.frameRate);
    this.video.pause();
    this.seek(this.progress, true);
  };

  handleLoadedData = () => {
    if (!this.ready || this.presented) return;
    this.presented = true;
    this.video.pause();
    this.onReady?.();
    this.seek(this.progress, true);
  };

  handleError = () => {
    if (this.failed) return;
    this.failed = true;
    this.ready = false;
    this.video.pause();
    this.onError?.();
  };

  setActive(active) {
    this.active = active;
    if (active) this.seek(this.progress, true);
  }

  seek(progress, force = false) {
    this.progress = clamp(progress);
    if (!this.ready || this.failed || (!this.active && !force)) return;

    const rawTarget = mapVideoProgress(this.progress) * this.finalFrame;
    // Source clips are 24 fps: resolve every seek to a decoded source-frame boundary.
    // This keeps demo mode and rapid interrupted scrolling deterministic instead of leaving
    // a browser at an arbitrary fractional timestamp between authored frames.
    this.targetTime = Math.min(this.finalFrame, Math.round(rawTarget * this.frameRate) / this.frameRate);
    if (this.framePending && !force) return;
    this.framePending = true;

    requestAnimationFrame(() => {
      this.framePending = false;
      if (!this.ready || this.failed) return;

      const target = this.targetTime;
      if (force || Math.abs(this.video.currentTime - target) > 0.008) {
        this.video.currentTime = target;
      }
      this.video.pause();
    });
  }

  reset() {
    this.progress = 0;
    this.seek(0, true);
  }

  destroy() {
    this.video.removeEventListener('loadedmetadata', this.handleMetadata);
    this.video.removeEventListener('loadeddata', this.handleLoadedData);
    this.video.removeEventListener('error', this.handleError);
    this.video.pause();
  }
}

export const cueValue = (progress, range) => {
  const [start, end] = range.split(',').map(Number);
  return clamp((progress - start) / Math.max(0.001, end - start));
};
