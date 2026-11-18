import { useEffect, useRef } from "react";

import { createDataOrbRenderer } from "./dataOrbGL.ts";
import "./dataOrb.css";

export type DataOrbStatus =
  | "idle"
  | "focused"
  | "typing"
  | "processing"
  | "retrieving"
  | "generating"
  | "completed"
  | "failed"
  | "cancelled";

export type DataOrbProps = {
  status: DataOrbStatus;
  effects: "full" | "subtle" | "off";
  theme: "light" | "dark";
  pulseKey?: number;
  className?: string;
};

const energyByStatus = {
  idle: 0,
  focused: 0.3,
  typing: 0.45,
  processing: 0.72,
  retrieving: 0.85,
  generating: 1,
  completed: 0.55,
  failed: 0.15,
  cancelled: 0,
} satisfies Record<DataOrbStatus, number>;

const budget = {
  full: { interval: 1000 / 30, dpr: 1.5, intensity: 1 },
  subtle: { interval: 1000 / 20, dpr: 1, intensity: 0.55 },
} as const;

export function DataOrb({ status, effects, theme, pulseKey, className }: DataOrbProps) {
  const surface = useRef<HTMLDivElement>(null);
  const failed = useRef(false);
  const signal = useRef({ status, effects, theme, pulseKey, pulse: 0 });
  const enabled = effects !== "off";

  useEffect(() => {
    const previous = signal.current;
    const pulse = enabled && pulseKey !== previous.pulseKey ? Math.min(1, previous.pulse + 0.32) : previous.pulse;
    signal.current = { status, effects, theme, pulseKey, pulse: enabled ? pulse : 0 };
  }, [status, effects, theme, pulseKey, enabled]);

  useEffect(() => {
    const element = surface.current;
    if (!element || !enabled || failed.current || typeof IntersectionObserver === "undefined") return;

    const host = element;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let closed = false;
    let frameId: number | null = null;
    let nextDraw: number | undefined;
    let lastDraw: number | undefined;
    let time = 6.5;
    let energy = energyByStatus[signal.current.status];
    let canvas: HTMLCanvasElement | undefined;
    let renderer: ReturnType<typeof createDataOrbRenderer> | undefined;

    function stop() {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      nextDraw = undefined;
      lastDraw = undefined;
    }

    function release() {
      stop();
      canvas?.removeEventListener("webglcontextlost", fail);
      canvas?.remove();
      canvas = undefined;
      renderer?.dispose();
      renderer = undefined;
    }

    function fail() {
      failed.current = true;
      cleanup();
    }

    function sync() {
      if (closed) return;
      if (motion.matches) {
        signal.current.pulse = 0;
        release();
      } else if (!visible || document.hidden) {
        stop();
      } else if (frameId === null) {
        frameId = requestAnimationFrame(draw);
      }
    }

    function draw(now: number) {
      frameId = null;
      const current = signal.current;
      if (closed || !visible || document.hidden || motion.matches || current.effects === "off") return;

      const { interval, dpr, intensity } = budget[current.effects];
      // Allow for rAF timestamp jitter at common display refresh rates.
      if (nextDraw === undefined || now + 1 >= nextDraw) {
        nextDraw = Math.max((nextDraw ?? now) + interval, now + interval - 1);
        const dt = lastDraw === undefined ? 0 : Math.min((now - lastDraw) / 1000, 0.067);
        lastDraw = now;
        energy += (energyByStatus[current.status] - energy) * Math.min(1, dt * 3.2);
        const pulse = current.pulse;
        current.pulse *= Math.exp(-dt * 4.5);
        time += dt * intensity * (1 + energy * 0.6 + pulse * 1.2);

        const scale = Math.min(window.devicePixelRatio || 1, dpr);
        const width = Math.round(host.clientWidth * scale);
        const height = Math.round(host.clientHeight * scale);
        if (width && height) {
          try {
            if (!canvas) {
              canvas = document.createElement("canvas");
              canvas.addEventListener("webglcontextlost", fail);
            }
            renderer ??= createDataOrbRenderer(canvas);
            renderer.draw(width, height, { time, energy, pulse, dark: current.theme === "dark", intensity });
            if (!canvas.isConnected) host.append(canvas);
          } catch {
            fail();
            return;
          }
        }
      }
      sync();
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      sync();
    });
    observer.observe(host);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);

    function cleanup() {
      if (closed) return;
      closed = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
      release();
    }

    return cleanup;
  }, [enabled]);

  return (
    <div
      className={className ? `data-orb ${className}` : "data-orb"}
      data-theme={theme}
      data-status={status}
      aria-hidden="true"
    >
      <div ref={surface} className="data-orb__surface" />
      <span className="data-orb__static" />
    </div>
  );
}
