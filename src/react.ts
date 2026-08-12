// Headless hooks for result views.
//
// Deliberately no components and no styling: the views these feed (a staged
// reveal of a profile, a modal that fills in scores as they stream) are where
// each product's design lives, and a shared component would flatten both. What
// is genuinely the same is the TIMING — the state machines below.
//
// Imported from "dig-engine/react" so the core stays runnable without React.

import { useEffect, useRef, useState } from "react";

export type StagedRevealOptions = {
  /** Delay before the first step. Default: same as stepMs. */
  initialDelayMs?: number;
  /** Delay between steps. Default: 900. */
  stepMs?: number;
  /** Start paused (e.g. until the data has arrived). Default: true. */
  enabled?: boolean;
};

export type StagedReveal = {
  /** How many steps are currently revealed (0..steps). */
  revealed: number;
  isRevealing: boolean;
  isComplete: boolean;
  /** Whether step `index` (0-based) is out yet. */
  isVisible(index: number): boolean;
  /** Reveal everything immediately — for a "skip" affordance. */
  revealAll(): void;
  reset(): void;
};

/**
 * Reveal N parts one after another. Used for layered results (story, then
 * light and shadow, then the name) and for score rows filling in one by one.
 */
export function useStagedReveal(steps: number, options: StagedRevealOptions = {}): StagedReveal {
  const stepMs = options.stepMs ?? 900;
  const initialDelayMs = options.initialDelayMs ?? stepMs;
  const enabled = options.enabled ?? true;
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (!enabled || revealed >= steps) return;
    const delay = revealed === 0 ? initialDelayMs : stepMs;
    const timer = setTimeout(() => setRevealed((n) => Math.min(steps, n + 1)), delay);
    return () => clearTimeout(timer);
  }, [enabled, revealed, steps, stepMs, initialDelayMs]);

  // A shrinking step count (a mode with fewer layers) must not leave the
  // counter stranded above the end.
  useEffect(() => {
    setRevealed((n) => Math.min(n, steps));
  }, [steps]);

  return {
    revealed,
    isRevealing: enabled && revealed < steps,
    isComplete: revealed >= steps,
    isVisible: (index) => index < revealed,
    revealAll: () => setRevealed(steps),
    reset: () => setRevealed(0),
  };
}

export type TypewriterOptions = {
  /** Characters per second. Default: 45. */
  charsPerSecond?: number;
  enabled?: boolean;
};

/**
 * Type text out character by character. Safe for streaming input: when `text`
 * grows, typing continues from where it was instead of restarting, and when it
 * is replaced outright the position resets.
 */
export function useTypewriter(text: string, options: TypewriterOptions = {}): string {
  const charsPerSecond = options.charsPerSecond ?? 45;
  const enabled = options.enabled ?? true;
  const [count, setCount] = useState(0);
  const previous = useRef("");

  useEffect(() => {
    if (!text.startsWith(previous.current)) setCount(0);
    previous.current = text;
  }, [text]);

  useEffect(() => {
    if (!enabled) {
      setCount(text.length);
      return;
    }
    if (count >= text.length) return;
    const timer = setTimeout(() => setCount((n) => Math.min(text.length, n + 1)), 1000 / charsPerSecond);
    return () => clearTimeout(timer);
  }, [enabled, count, text, charsPerSecond]);

  return enabled ? text.slice(0, count) : text;
}

export type CountUpOptions = {
  /** Animation length in ms. Default: 500. */
  durationMs?: number;
  enabled?: boolean;
};

/** Ease-out interpolation from 0 to `target`, for score readouts. */
export function useCountUp(target: number, options: CountUpOptions = {}): number {
  const durationMs = options.durationMs ?? 500;
  const enabled = options.enabled ?? true;
  const [value, setValue] = useState(enabled ? 0 : target);

  useEffect(() => {
    if (!enabled || target <= 0) {
      setValue(target > 0 ? target : 0);
      return;
    }
    let frame = 0;
    let startedAt: number | null = null;
    const step = (timestamp: number) => {
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / durationMs);
      setValue(target * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, enabled]);

  return value;
}
