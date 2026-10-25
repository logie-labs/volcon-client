//! The one place a control position becomes a level.
//!
//! A control's position travels through an ordered chain of modifiers before it
//! reaches an app's mixer session:
//!
//! ```text
//!   position (0-127 from the controller)
//!     -> Curve   response shaping, global, from settings
//!     -> Trim    per-app balance, 0-1
//!     -> Mute    per-app, a flag rather than a level
//!   = ResolvedLevel { scalar, muted }
//! ```
//!
//! With the curve off, the level is worked in whole percents — the control's
//! position and the trim, each as the app shows it — so a control at 14% sets
//! the mixer to 14%. Only a curve, which bends the travel between whole numbers,
//! gives a level decimals.
//!
//! Everything that needs a level calls [`resolve`] — the MIDI callback, live trim
//! and mute edits, and a change of curve all re-run the same chain. Nothing else
//! may apply a stage on its own: a second implementation of any stage is how the
//! displayed level and the audible one drift apart.
//!
//! The UI mirrors this chain in `lib/volume-levels.ts` so it can label a level
//! without a round trip per frame. That mirror is only safe because it draws its
//! curve from what this layer reports back, never from settings storage directly.

/// How a control's position is shaped before anything else touches it.
///
/// Loudness is perceived roughly logarithmically, so a straight line from a
/// fader to a volume scalar spends most of its travel in a range that barely
/// sounds different. Bending the response gives the quiet end — where the ear
/// resolves the most detail — more of the control.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VolumeCurve {
    pub enabled: bool,
    /// 0-100, straight off the settings slider.
    pub strength: f32,
}

impl Default for VolumeCurve {
    fn default() -> Self {
        Self {
            enabled: false,
            strength: 20.0,
        }
    }
}

/// The exponent at full strength. Past about 4 the bottom of the control becomes
/// too coarse to set a usable level with.
///
/// Mirrored by `MAX_GAMMA` in `lib/volume-levels.ts`.
pub const MAX_GAMMA: f32 = 4.0;

/// How close counts as arrived, in volume scalar. Below this the difference is
/// inaudible and further ticks are wasted work.
pub const CONVERGED_EPSILON: f32 = 0.001;

fn sane(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

impl VolumeCurve {
    fn gamma(&self) -> f32 {
        let strength = sane(self.strength, 0.0).clamp(0.0, 100.0);

        1.0 + (strength / 100.0) * (MAX_GAMMA - 1.0)
    }

    /// Stage 1. Maps a 0-1 position to a 0-1 position. Both ends are fixed:
    /// silent stays silent and full stays full, only the travel between changes.
    pub fn shape(&self, position: f32) -> f32 {
        let position = sane(position, 0.0).clamp(0.0, 1.0);

        if !self.enabled {
            return position;
        }

        position.powf(self.gamma())
    }
}

/// What the chain is being run for: one app's share of one control.
#[derive(Clone, Copy, Debug)]
pub struct LevelInput {
    /// Raw controller position, 0-127.
    pub position: u8,
    /// Stage 2. Per-app balance against the others on the same control, 0-1.
    pub trim: f32,
    /// Stage 3. Silences the app without disturbing the level it returns to.
    pub muted: bool,
}

/// What the mixer should be set to.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResolvedLevel {
    /// 0-1, for `ISimpleAudioVolume::SetMasterVolume`.
    pub scalar: f32,
    /// For `SetMute`. Kept separate from the scalar so a muted app keeps the
    /// level it comes back to.
    pub muted: bool,
}

/// Runs the full chain. The only route from a control position to a level.
pub fn resolve(input: LevelInput, curve: VolumeCurve) -> ResolvedLevel {
    let trim = sane(input.trim, 1.0).clamp(0.0, 1.0);

    let scalar = if curve.enabled {
        curve.shape(input.position as f32 / 127.0) * trim
    } else {
        whole_percent_level(input.position, trim)
    };

    ResolvedLevel {
        scalar: scalar.clamp(0.0, 1.0),
        muted: input.muted,
    }
}

/// The level with the curve off: the position and the trim as whole percents,
/// multiplied and rounded to a whole percent again. 18/127 is 14.17%, but the
/// control reads 14%, so that's what the mixer is set to. Whole numbers, rather
/// than floats, so the UI's mirror can't round a hair the other way.
///
/// Mirrored by `wholeLevelPercent` in `lib/volume-levels.ts`.
fn whole_percent_level(position: u8, trim: f32) -> f32 {
    let position = (position as f32 / 127.0 * 100.0).round().min(100.0) as u32;
    let trim = (trim * 100.0).round() as u32;

    percent_scalar((position * trim + 50) / 100)
}

/// A whole percent as a mixer scalar, never a hair under it. The nearest `f32`
/// to some percents falls short — 0.29 is 0.28999999 — and a mixer that cuts
/// its figure down to a whole number, rather than rounding it, would show 28%.
fn percent_scalar(percent: u32) -> f32 {
    let scalar = percent as f32 / 100.0;

    if (scalar as f64) < percent as f64 / 100.0 {
        scalar.next_up()
    } else {
        scalar
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn linear() -> VolumeCurve {
        VolumeCurve {
            enabled: false,
            strength: 50.0,
        }
    }

    fn curved(strength: f32) -> VolumeCurve {
        VolumeCurve {
            enabled: true,
            strength,
        }
    }

    fn scalar(position: u8, trim: f32, curve: VolumeCurve) -> f32 {
        resolve(
            LevelInput {
                position,
                trim,
                muted: false,
            },
            curve,
        )
        .scalar
    }

    #[test]
    fn disabled_curve_sets_the_whole_percent_the_control_reads() {
        assert_eq!(scalar(127, 1.0, linear()), 1.0);
        assert_eq!(scalar(0, 1.0, linear()), 0.0);
        // 18/127 is 14.17%, 70/127 is 55.12%.
        assert!((scalar(18, 1.0, linear()) - 0.14).abs() < 1e-6);
        assert!((scalar(70, 1.0, linear()) - 0.55).abs() < 1e-6);
        // 55% at 70% trim is 38.5%, which rounds up.
        assert!((scalar(70, 0.7, linear()) - 0.39).abs() < 1e-6);
        // Strength is ignored entirely while the curve is off.
        assert_eq!(scalar(64, 1.0, linear()), scalar(64, 1.0, VolumeCurve::default()));
    }

    #[test]
    fn whole_percents_are_never_a_hair_under() {
        for position in 0..=127u8 {
            for trim in 0..=100u8 {
                let position_percent = (position as f64 / 127.0 * 100.0).round();
                let expected = (position_percent * trim as f64 / 100.0).round() / 100.0;
                let level = scalar(position, trim as f32 / 100.0, linear()) as f64;

                assert!(
                    level >= expected && level - expected < 1e-6,
                    "position {position} at {trim}% trim set {level}, not {expected}"
                );
            }
        }
    }

    #[test]
    fn curve_holds_both_ends_and_lowers_the_middle() {
        let curve = curved(100.0);

        assert!((scalar(0, 1.0, curve) - 0.0).abs() < 1e-6);
        assert!((scalar(127, 1.0, curve) - 1.0).abs() < 1e-6);
        assert!(scalar(64, 1.0, curve) < scalar(64, 1.0, linear()));
    }

    #[test]
    fn stronger_curves_bend_further() {
        assert!(scalar(64, 1.0, curved(100.0)) < scalar(64, 1.0, curved(20.0)));
        // Zero strength is a straight line even when enabled, through the exact
        // position rather than its whole percent.
        assert!((scalar(64, 1.0, curved(0.0)) - 64.0 / 127.0).abs() < 1e-6);
    }

    #[test]
    fn trim_scales_the_shaped_level_not_the_raw_position() {
        let curve = curved(100.0);
        let full = scalar(64, 1.0, curve);

        assert!((scalar(64, 0.5, curve) - full * 0.5).abs() < 1e-6);
        // Trimming before shaping would give a different, larger number.
        assert!((scalar(64, 0.5, curve) - curve.shape(0.5 * 64.0 / 127.0)).abs() > 1e-6);
    }

    #[test]
    fn mute_rides_alongside_the_level_it_returns_to() {
        let resolved = resolve(
            LevelInput {
                position: 64,
                trim: 1.0,
                muted: true,
            },
            linear(),
        );

        assert!(resolved.muted);
        assert!(resolved.scalar > 0.0);
    }

    #[test]
    fn nonsense_inputs_are_survivable() {
        assert!((scalar(64, f32::NAN, linear()) - scalar(64, 1.0, linear())).abs() < 1e-6);
        assert!((scalar(64, 5.0, linear()) - scalar(64, 1.0, linear())).abs() < 1e-6);

        let broken = VolumeCurve {
            enabled: true,
            strength: f32::NAN,
        };
        assert!((scalar(64, 1.0, broken) - scalar(64, 1.0, curved(0.0))).abs() < 1e-6);
    }
}
