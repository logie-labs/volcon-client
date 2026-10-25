//! Drops control changes too small to be deliberate, from a control at rest.
//!
//! Some controllers never quite sit still. A worn pot or a noisy fader wanders a
//! step or two either side of where it was left, and every one of those steps
//! arrives as a fresh control change — each one re-aiming the volume and raising
//! the overlay as though someone had reached for the knob.
//!
//! So a control that has been left alone has to move further than the deadzone
//! before it counts, measured from the last position let through rather than
//! the last one that arrived, so wobble can't walk the level away a step at a
//! time. Once the control is moving nothing is held back: a turn tracks the knob
//! step for step, and the deadzone only re-engages when the control settles.
//!
//! Settling is judged by travel, not by messages. A control is at rest once it
//! has gone [`SETTLE_AFTER`] without covering a deadzone's width; wobble that
//! arrives every few milliseconds would otherwise keep a resting control looking
//! busy for good.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The highest position a control change can report.
const MAX_POSITION: u8 = 127;

/// The widest deadzone accepted, in percent of a control's travel. Past this a
/// control is too coarse to set a level with.
pub const MAX_DEADZONE_PERCENT: u8 = 25;

/// How long a moving control has to go without covering a deadzone's width
/// before it counts as at rest, and the deadzone applies to it again.
pub const SETTLE_AFTER: Duration = Duration::from_millis(750);

/// The deadzone setting, shared between the bridge that sets it and the MIDI
/// callback that applies it.
#[derive(Clone, Default)]
pub struct Deadzone {
    /// Percent of a control's travel. Atomic so the MIDI callback can read it on
    /// every message without taking a lock.
    percent: Arc<AtomicU8>,
}

impl Deadzone {
    /// Returns the width actually in force, after clamping.
    pub fn set_percent(&self, percent: u8) -> u8 {
        let percent = percent.min(MAX_DEADZONE_PERCENT);
        self.percent.store(percent, Ordering::Relaxed);
        percent
    }

    pub fn percent(&self) -> u8 {
        self.percent.load(Ordering::Relaxed)
    }

    /// Starts tracking controls for one connection to a controller. The width
    /// stays live: changing the setting takes effect on the next message.
    pub fn filter(&self) -> DeadzoneFilter {
        DeadzoneFilter {
            deadzone: self.clone(),
            controls: HashMap::new(),
        }
    }
}

struct ControlState {
    /// The last position let through.
    resting: u8,
    /// Where the current movement last covered a deadzone's width, and when.
    /// The control is moving until [`SETTLE_AFTER`] has passed since then.
    anchor: u8,
    anchored_at: Instant,
}

/// Where each control is and whether it is on the move.
pub struct DeadzoneFilter {
    deadzone: Deadzone,
    controls: HashMap<u8, ControlState>,
}

impl DeadzoneFilter {
    /// Whether a control change is real movement.
    pub fn admit(&mut self, control: u8, value: u8) -> bool {
        self.admit_at(control, value, Instant::now())
    }

    fn admit_at(&mut self, control: u8, value: u8, now: Instant) -> bool {
        let threshold = u32::from(self.deadzone.percent());
        // `steps / 127 >= threshold / 100`, kept in whole numbers.
        let clears = |from: u8| u32::from(from.abs_diff(value)) * 100 >= threshold * u32::from(MAX_POSITION);

        let Some(state) = self.controls.get_mut(&control) else {
            // Nothing to measure against yet: this is where the control is, and
            // most likely someone has just reached for it.
            self.controls.insert(
                control,
                ControlState {
                    resting: value,
                    anchor: value,
                    anchored_at: now,
                },
            );
            return true;
        };

        if now.duration_since(state.anchored_at) < SETTLE_AFTER {
            state.resting = value;

            // Only travel keeps the control moving. Wobble around where it
            // stopped is let through, but it doesn't put off settling.
            if clears(state.anchor) {
                state.anchor = value;
                state.anchored_at = now;
            }

            return true;
        }

        // The ends always get through, or a control resting a step or two short
        // of the top or bottom could never reach it.
        let reaches_end = value != state.resting && (value == 0 || value == MAX_POSITION);

        if !clears(state.resting) && !reaches_end {
            return false;
        }

        *state = ControlState {
            resting: value,
            anchor: value,
            anchored_at: now,
        };
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESTED: u64 = 2_000;

    struct Clock(Instant);

    impl Clock {
        fn new() -> Self {
            Self(Instant::now())
        }

        fn at(&self, ms: u64) -> Instant {
            self.0 + Duration::from_millis(ms)
        }
    }

    fn filter(percent: u8) -> DeadzoneFilter {
        let deadzone = Deadzone::default();
        deadzone.set_percent(percent);
        deadzone.filter()
    }

    #[test]
    fn off_lets_everything_through() {
        let clock = Clock::new();
        let mut filter = filter(0);

        assert!(filter.admit_at(7, 64, clock.at(0)));
        assert!(filter.admit_at(7, 65, clock.at(RESTED)));
        // Even a repeat from rest: with no deadzone, nothing about the old
        // behaviour changes.
        assert!(filter.admit_at(7, 65, clock.at(2 * RESTED)));
    }

    #[test]
    fn the_first_message_always_counts() {
        let clock = Clock::new();
        let mut filter = filter(10);

        assert!(filter.admit_at(7, 64, clock.at(0)));
    }

    #[test]
    fn wobble_at_rest_is_dropped() {
        // 3% of the travel is 3.81 steps, so up to 3 steps either way is wobble.
        let clock = Clock::new();
        let mut filter = filter(3);

        assert!(filter.admit_at(7, 64, clock.at(0)));
        assert!(!filter.admit_at(7, 66, clock.at(RESTED)));
        assert!(!filter.admit_at(7, 61, clock.at(RESTED + 10)));
        assert!(!filter.admit_at(7, 67, clock.at(RESTED + 20)));
        assert!(filter.admit_at(7, 68, clock.at(RESTED + 30)));
    }

    #[test]
    fn wobble_at_rest_cannot_creep_past_a_step_at_a_time() {
        let clock = Clock::new();
        let mut filter = filter(3);

        assert!(filter.admit_at(7, 64, clock.at(0)));

        for (index, value) in (65..=67).enumerate() {
            assert!(!filter.admit_at(7, value, clock.at(RESTED + index as u64)));
        }

        // Still measured from 64, not from wherever the wobble last got to.
        assert!(!filter.admit_at(7, 66, clock.at(RESTED + 10)));
        assert!(filter.admit_at(7, 68, clock.at(RESTED + 20)));
    }

    #[test]
    fn a_moving_control_gets_every_step() {
        let clock = Clock::new();
        let mut filter = filter(3);

        assert!(filter.admit_at(7, 64, clock.at(0)));
        // Waking it takes a deadzone's worth of travel...
        assert!(filter.admit_at(7, 68, clock.at(RESTED)));

        // ...after which a slow turn goes through one step at a time, for as
        // long as it keeps covering the deadzone within the settle time.
        for step in 1..=20u8 {
            let at = clock.at(RESTED + u64::from(step) * 150);
            assert!(filter.admit_at(7, 68 + step, at), "step {step} was held back");
        }

        // Reversing mid-turn is still movement.
        assert!(filter.admit_at(7, 87, clock.at(RESTED + 3_100)));
    }

    #[test]
    fn a_control_settles_once_it_stops_travelling() {
        let clock = Clock::new();
        let mut filter = filter(3);

        assert!(filter.admit_at(7, 64, clock.at(0)));
        assert!(filter.admit_at(7, 80, clock.at(RESTED)));

        // Wobble right after stopping still gets through: the control hasn't
        // settled yet.
        assert!(filter.admit_at(7, 81, clock.at(RESTED + 100)));
        assert!(filter.admit_at(7, 79, clock.at(RESTED + 300)));

        // But it doesn't keep the control awake. The settle time runs from the
        // last real travel, so wobble arriving constantly is held back once it
        // has passed.
        let mut at = RESTED + 300;
        for value in [80, 81, 80, 79, 80, 81, 80, 79] {
            at += 100;
            let admitted = filter.admit_at(7, value, clock.at(at));
            assert_eq!(admitted, at - RESTED < SETTLE_AFTER.as_millis() as u64, "at {at}ms");
        }
    }

    #[test]
    fn the_ends_are_always_reachable_from_rest() {
        let clock = Clock::new();
        let mut filter = filter(5);

        assert!(filter.admit_at(7, 125, clock.at(0)));
        assert!(filter.admit_at(7, 127, clock.at(RESTED)));
        // Resting there is still quiet, though.
        assert!(!filter.admit_at(7, 127, clock.at(2 * RESTED)));
        assert!(!filter.admit_at(7, 125, clock.at(2 * RESTED + 10)));

        assert!(filter.admit_at(7, 2, clock.at(3 * RESTED)));
        assert!(filter.admit_at(7, 0, clock.at(4 * RESTED)));
    }

    #[test]
    fn each_control_is_measured_on_its_own() {
        let clock = Clock::new();
        let mut filter = filter(5);

        assert!(filter.admit_at(7, 64, clock.at(0)));
        // A different control waking up doesn't wake this one.
        assert!(filter.admit_at(8, 66, clock.at(RESTED)));
        assert!(!filter.admit_at(7, 66, clock.at(RESTED + 10)));
    }

    #[test]
    fn the_setting_is_clamped_and_applies_straight_away() {
        let clock = Clock::new();
        let deadzone = Deadzone::default();
        assert_eq!(deadzone.set_percent(200), MAX_DEADZONE_PERCENT);

        let mut filter = deadzone.filter();
        assert!(filter.admit_at(7, 64, clock.at(0)));
        assert!(!filter.admit_at(7, 70, clock.at(RESTED)));

        deadzone.set_percent(0);
        assert!(filter.admit_at(7, 65, clock.at(RESTED + 10)));
    }
}
