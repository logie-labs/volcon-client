"use client"

/**
 * The app's greens, light to dark - the lime the primary colour is drawn from,
 * as hex because the confetti canvas can't read a CSS variable.
 */
const greens = ["#d8f999", "#bbf451", "#9ae600", "#7ccf00", "#5ea500"]

/**
 * One burst of confetti from each side of the window, angled in towards the
 * middle. Magic UI's side cannons fire for three seconds; this fires once.
 *
 * Skipped entirely for anyone who has asked for reduced motion. The library is
 * loaded on first use rather than with the page, since most sessions never
 * learn a control.
 */
export async function fireSideCannons() {
  const { default: confetti } = await import("canvas-confetti")

  const shared = {
    particleCount: 70,
    spread: 55,
    startVelocity: 60,
    ticks: 220,
    colors: greens,
    // Square, like everything else in the app.
    shapes: ["square" as const],
    disableForReducedMotion: true,
  }

  void confetti({ ...shared, angle: 60, origin: { x: 0, y: 0.6 } })
  void confetti({ ...shared, angle: 120, origin: { x: 1, y: 0.6 } })
}
