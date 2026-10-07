// Player sound effects: volume boost, night mode (compression), clear voices
// (speech EQ), audio delay, and remembered volume. Uses Web Audio on the
// <video> element; the graph is only built once an effect is switched on.
import { useCallback, useEffect, useRef, useState } from "react";

export type AudioFx = {
  boost: number; // 1 = 100%, up to 2 = 200%
  night: boolean;
  voice: boolean;
  delayMs: number; // 0–500, delays sound when it arrives before the picture
  remember: boolean;
  volume: number; // remembered volume 0–1
};

const KEY = "relay.audioFx";
export const DEFAULT_FX: AudioFx = { boost: 1, night: false, voice: false, delayMs: 0, remember: true, volume: 1 };

function load(): AudioFx {
  try {
    return { ...DEFAULT_FX, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULT_FX;
  }
}

type Graph = {
  ctx: AudioContext;
  gain: GainNode;
  comp: DynamicsCompressorNode;
  voice: BiquadFilterNode;
  low: BiquadFilterNode;
  delay: DelayNode;
};
const graphs = new WeakMap<HTMLMediaElement, Graph>();

function buildGraph(el: HTMLMediaElement): Graph | null {
  const existing = graphs.get(el);
  if (existing) return existing;
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new Ctx();
    const src = ctx.createMediaElementSource(el);
    const delay = ctx.createDelay(1);
    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 200;
    const voice = ctx.createBiquadFilter();
    voice.type = "peaking";
    voice.frequency.value = 2500;
    voice.Q.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    const gain = ctx.createGain();
    src.connect(delay).connect(low).connect(voice).connect(comp).connect(gain).connect(ctx.destination);
    const g = { ctx, gain, comp, voice, low, delay };
    graphs.set(el, g);
    return g;
  } catch (e) {
    console.warn("Audio effects unavailable", e);
    return null;
  }
}

function apply(g: Graph, fx: AudioFx) {
  const t = g.ctx.currentTime;
  g.gain.gain.setTargetAtTime(fx.boost * (fx.night ? 1.4 : 1), t, 0.05);
  g.delay.delayTime.setTargetAtTime(fx.delayMs / 1000, t, 0.05);
  g.voice.gain.setTargetAtTime(fx.voice ? 6 : 0, t, 0.05);
  g.low.gain.setTargetAtTime(fx.voice ? -4 : 0, t, 0.05);
  if (fx.night) {
    g.comp.threshold.value = -35;
    g.comp.knee.value = 20;
    g.comp.ratio.value = 8;
    g.comp.attack.value = 0.005;
    g.comp.release.value = 0.3;
  } else {
    g.comp.threshold.value = 0;
    g.comp.knee.value = 0;
    g.comp.ratio.value = 1;
  }
  if (g.ctx.state === "suspended") void g.ctx.resume();
}

export function useAudioFx(videoRef: React.RefObject<HTMLVideoElement | null>, deps: unknown[] = []) {
  const [fx, setFx] = useState<AudioFx>(DEFAULT_FX);
  const [active, setActive] = useState(false);
  const fxRef = useRef(fx);
  fxRef.current = fx;

  useEffect(() => setFx(load()), []);

  const update = useCallback((patch: Partial<AudioFx>) => {
    setFx((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // Build/apply the effect chain when something is switched on.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const needed = fx.boost !== 1 || fx.night || fx.voice || fx.delayMs > 0;
    const g = needed ? buildGraph(el) : graphs.get(el);
    if (g) {
      apply(g, fx);
      setActive(true);
    }
    const resume = () => g && g.ctx.state === "suspended" && void g.ctx.resume();
    el.addEventListener("play", resume);
    return () => el.removeEventListener("play", resume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx.boost, fx.night, fx.voice, fx.delayMs, ...deps]);

  // Remember volume between titles.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const restore = () => {
      if (fxRef.current.remember) el.volume = Math.min(1, Math.max(0, fxRef.current.volume));
    };
    const save = () => {
      if (fxRef.current.remember && !el.muted) update({ volume: el.volume });
    };
    restore();
    el.addEventListener("loadedmetadata", restore);
    el.addEventListener("volumechange", save);
    return () => {
      el.removeEventListener("loadedmetadata", restore);
      el.removeEventListener("volumechange", save);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { fx, update, active };
}
