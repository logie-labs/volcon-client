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
    let position = input.position as f32 / 127.0;
    let shaped = curve.shape(position);
    let trimmed = shaped * sane(input.trim, 1.0).clamp(0.0, 1.0);

    ResolvedLevel {
        scalar: trimmed.clamp(0.0, 1.0),
        muted: input.muted,
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
    fn disabled_curve_passes_the_position_straight_through() {
        assert!((scalar(127, 1.0, linear()) - 1.0).abs() < 1e-6);
        assert!((scalar(0, 1.0, linear()) - 0.0).abs() < 1e-6);
        // Strength is ignored entirely while the curve is off.
        assert!((scalar(64, 1.0, linear()) - scalar(64, 1.0, VolumeCurve::default())).abs() < 1e-6);
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
        // Zero strength is a straight line even when enabled.
        assert!((scalar(64, 1.0, curved(0.0)) - scalar(64, 1.0, linear())).abs() < 1e-6);
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
        assert!((scalar(64, 1.0, broken) - scalar(64, 1.0, linear())).abs() < 1e-6);
    }
}
