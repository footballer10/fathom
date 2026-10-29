import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { TIMER_WARNING_SECONDS } from "@fathom/shared";
import { serverNow } from "../api";

/**
 * A rounded ring drawn around its children (the answer input) that drains as
 * time runs out and turns red in the last few seconds.
 *
 * Timing: the server owns the deadline (`endsAt`, in server time). Every frame
 * we compute what's left against our estimate of the server clock, and write
 * the result straight to the SVG/DOM, skipping React re-renders, so the ring
 * stays smooth at 60fps. `onExpire` fires once when the clock hits zero.
 */
export function TimerRing({
  endsAt,
  totalMs,
  running,
  onExpire,
  children,
}: {
  endsAt: number;
  totalMs: number;
  running: boolean;
  onExpire: () => void;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<SVGRectElement>(null);
  const secondsRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let fired = false;
    const tick = () => {
      const left = Math.max(0, endsAt - serverNow());
      const frac = Math.min(1, left / totalMs);
      rectRef.current?.style.setProperty("stroke-dashoffset", String(100 - frac * 100));
      if (secondsRef.current) secondsRef.current.textContent = String(Math.ceil(left / 1000));
      wrapRef.current?.classList.toggle("timer--low", left <= TIMER_WARNING_SECONDS * 1000);
      if (!running) return;
      if (left <= 0) {
        if (!fired) {
          fired = true;
          expireRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [endsAt, totalMs, running]);

  const stroke = 4;
  const radius = 18;
  return (
    <div ref={wrapRef} className="timer">
      {size.w > 0 && (
        <svg className="timer-svg" width={size.w} height={size.h} aria-hidden="true">
          <rect
            className="timer-track"
            x={stroke / 2}
            y={stroke / 2}
            width={size.w - stroke}
            height={size.h - stroke}
            rx={radius}
            strokeWidth={stroke}
          />
          <rect
            ref={rectRef}
            className="timer-bar"
            x={stroke / 2}
            y={stroke / 2}
            width={size.w - stroke}
            height={size.h - stroke}
            rx={radius}
            strokeWidth={stroke}
            pathLength={100}
            strokeDasharray="100 100"
          />
        </svg>
      )}
      {children}
      <span className="timer-seconds" aria-live="off">
        <span ref={secondsRef} />s
      </span>
    </div>
  );
}
