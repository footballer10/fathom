import { useEffect, useRef } from "react";
import type { MotionValue } from "framer-motion";

/**
 * Canvas particle layer: rising bubbles and drifting "marine snow".
 * Bubbles thin out as you dive; marine snow thickens. The loop pauses
 * whenever the tab is hidden, and nothing runs when particles are off.
 */

interface Particle {
  kind: "bubble" | "snow";
  x: number;
  y: number;
  r: number;
  speed: number;
  wobble: number;
  phase: number;
  alpha: number;
}

const MAX_BUBBLES = 46;
const MAX_SNOW = 120;

export function Particles({ depth, enabled }: { depth: MotionValue<number>; enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const spawn = (kind: Particle["kind"], anywhere: boolean): Particle => {
      const bubble = kind === "bubble";
      return {
        kind,
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : bubble ? height + 10 : -10,
        r: bubble ? 1.5 + Math.random() * 4.5 : 0.6 + Math.random() * 1.6,
        speed: bubble ? 25 + Math.random() * 45 : 6 + Math.random() * 12,
        wobble: bubble ? 6 + Math.random() * 10 : 10 + Math.random() * 20,
        phase: Math.random() * Math.PI * 2,
        alpha: bubble ? 0.25 + Math.random() * 0.4 : 0.25 + Math.random() * 0.5,
      };
    };

    const bubbles: Particle[] = Array.from({ length: MAX_BUBBLES }, () => spawn("bubble", true));
    const snow: Particle[] = Array.from({ length: MAX_SNOW }, () => spawn("snow", true));

    const frame = (now: number) => {
      // Clamp dt so a long pause (tab switch) doesn't teleport particles.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const d = depth.get();
      const bubbleCount = Math.round(MAX_BUBBLES * Math.max(0.15, 1 - d / 4000));
      const snowCount = Math.round(MAX_SNOW * Math.min(1, 0.15 + d / 3000));

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < bubbleCount; i++) {
        const p = bubbles[i];
        p.y -= p.speed * dt;
        p.phase += dt * 2;
        if (p.y < -12) bubbles[i] = spawn("bubble", false);
        const x = p.x + Math.sin(p.phase) * p.wobble;
        ctx.beginPath();
        ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(220, 245, 255, ${p.alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha * 0.8})`;
        ctx.fill();
      }

      ctx.fillStyle = "rgb(230, 238, 245)";
      for (let i = 0; i < snowCount; i++) {
        const p = snow[i];
        p.y += p.speed * dt;
        p.phase += dt * 0.6;
        if (p.y > height + 10) snow[i] = spawn("snow", false);
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(p.phase) * p.wobble, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      ctx.clearRect(0, 0, width, height);
    };
  }, [depth, enabled]);

  return <canvas ref={canvasRef} className="particles" aria-hidden="true" />;
}
