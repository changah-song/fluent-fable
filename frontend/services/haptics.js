// Centralized haptic feedback.
//
// One import for the whole app, so haptics stay deliberate and consistent, and
// so there is a single place to gate them behind a future "reduce haptics"
// preference (some people find haptics uncomfortable — turning them off is an
// accessibility consideration, not just a nicety).
//
// Every call is wrapped: expo-haptics can reject on devices without a haptics
// engine (or an unsupported emulator), and a missed buzz must never surface as
// an error to the user.

import * as Haptics from 'expo-haptics';

// Flip to false to silence all haptics globally. Later this can read from a
// user preference instead of a constant.
let hapticsEnabled = true;

export function setHapticsEnabled(enabled) {
  hapticsEnabled = !!enabled;
}

function safe(run) {
  if (!hapticsEnabled) return;
  try {
    // Fire-and-forget: we never await, and we swallow rejections.
    run()?.catch?.(() => {});
  } catch {
    // Synchronous throw (e.g. module missing) — ignore.
  }
}

// The lightest possible tick. For the primary, high-frequency action of tapping
// a word to look it up — a whisper that makes the lookup feel physical without
// becoming fatiguing.
export function tapSelect() {
  safe(() => Haptics.selectionAsync());
}

// A firmer "click" for committing something — saving a word. You feel it land
// without looking.
export function tapCommit() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

// A gentle tick for an undo/removal — acknowledges the action without
// celebrating it. Deliberately lighter than tapCommit so the feedback matches
// the weight of the action.
export function tapUndo() {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
