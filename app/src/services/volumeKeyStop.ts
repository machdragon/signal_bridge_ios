/**
 * Volume-key emergency stop.
 *
 * Two triggers on volume-down input (both require relay to be non-DISCONNECTED):
 *  • Triple-press: 3 volume-down events within 1200 ms, each ≥ 100 ms apart
 *  • Long-hold:    sustained press for ≥ 2000 ms (iOS: rapid repeated events;
 *                  Android: same stream via react-native-volume-manager)
 *
 */

import { VolumeManager } from 'react-native-volume-manager';
import { useRelayStore } from '../store/relayStore';

// ── Tuning constants ────────────────────────────────────────────────
const TRIPLE_PRESS_WINDOW_MS = 1200;
const TRIPLE_PRESS_MIN_GAP_MS = 100;
const LONG_HOLD_MS = 2000;
/** Gap ≥ this → treat the next event as a new press, not a hold continuation */
const BURST_GAP_MS = 500;

// ── Module state ────────────────────────────────────────────────────
let stopCallback: (() => void) | null = null;
let listenerRemove: (() => void) | null = null;

let pressTimestamps: number[] = [];
let burstStartTime: number | null = null;
let lastEventTime = 0;
let holdTriggered = false;
let lastVolume: number | null = null;

// ── Public API ──────────────────────────────────────────────────────

export function initVolumeKeyStop(onStop: () => void): void {
  listenerRemove?.();
  listenerRemove = null;
  stopCallback = onStop;

  // Reset detection state
  pressTimestamps = [];
  burstStartTime = null;
  lastEventTime = 0;
  holdTriggered = false;
  lastVolume = null;

  VolumeManager.getVolume()
    .then((result) => {
      lastVolume = result.volume;
    })
    .catch(() => {
      // Keep null and infer from first event.
    });

  const subscription = VolumeManager.addVolumeListener((result) => {
    const prev = lastVolume;
    lastVolume = result.volume;

    if (prev == null) return;
    // Only treat downward volume changes as emergency-stop trigger input.
    if (result.volume >= prev - 0.0001) return;

    handleVolumeDownEvent();
  });
  listenerRemove = () => subscription.remove();
}

export function destroyVolumeKeyStop(): void {
  listenerRemove?.();
  listenerRemove = null;
  stopCallback = null;
  pressTimestamps = [];
  burstStartTime = null;
  holdTriggered = false;
  lastVolume = null;
}

// ── Detection logic ─────────────────────────────────────────────────

function handleVolumeDownEvent(): void {
  // Guard: only active when relay is not disconnected
  const { state } = useRelayStore.getState();
  if (state === 'DISCONNECTED') return;

  const now = Date.now();
  const timeSinceLast = lastEventTime === 0 ? Infinity : now - lastEventTime;

  if (timeSinceLast > BURST_GAP_MS) {
    // ── New press (not a continuation of a hold) ──
    burstStartTime = now;
    holdTriggered = false;

    // Evict stale timestamps outside the triple-press window
    pressTimestamps = pressTimestamps.filter((t) => now - t <= TRIPLE_PRESS_WINDOW_MS);

    // Debounce: ignore if the last recorded press was too recent
    const lastPress = pressTimestamps[pressTimestamps.length - 1];
    if (lastPress === undefined || now - lastPress >= TRIPLE_PRESS_MIN_GAP_MS) {
      pressTimestamps.push(now);
    }

    // Check triple-press
    if (pressTimestamps.length >= 3) {
      const sorted = [...pressTimestamps].sort((a, b) => a - b);
      const validGaps = sorted.every(
        (t, i) => i === 0 || t - sorted[i - 1] >= TRIPLE_PRESS_MIN_GAP_MS,
      );
      if (validGaps) {
        console.log('[VolumeKeyStop] Triple-press → emergency stop');
        resetState();
        triggerStop();
        return;
      }
    }
  }

  lastEventTime = now;

  // ── Long-hold check ──
  if (!holdTriggered && burstStartTime !== null && now - burstStartTime >= LONG_HOLD_MS) {
    console.log('[VolumeKeyStop] Long-hold → emergency stop');
    holdTriggered = true;
    triggerStop();
  }
}

function resetState(): void {
  pressTimestamps = [];
  burstStartTime = null;
  holdTriggered = false;
  lastEventTime = 0;
}

function triggerStop(): void {
  stopCallback?.();
}
