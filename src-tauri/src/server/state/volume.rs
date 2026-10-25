use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::levels::{resolve, LevelInput, VolumeCurve, CONVERGED_EPSILON};

/// One app's share of a control: which app to move, how much of the control's
/// position it should receive (`trim`), and whether it is muted outright.
#[derive(Clone, Debug)]
pub struct AppLevel {
    pub app: String,
    pub trim: f32,
    pub muted: bool,
}

impl AppLevel {
    pub fn new(app: String, trim: f32, muted: bool) -> Self {
        let trim = if trim.is_finite() {
            trim.clamp(0.0, 1.0)
        } else {
            1.0
        };

        Self { app, trim, muted }
    }
}

#[derive(Clone, Debug)]
pub struct AppVolumeTarget {
    pub app: String,
    pub target: f32,
    pub current: f32,
    pub control: u8,
    pub value: u8,
    pub trim: f32,
    pub muted: bool,
    /// Whether reaching this target is worth showing the overlay for. True when
    /// the controller moved, false for a trim or mute edit made in the UI — the
    /// window is already open and showing it, so popping the overlay over the
    /// top of it is just noise.
    pub notify: bool,
    /// Set whenever the target moved or the mute flag flipped, so the apply loop
    /// pushes the change through even when the smoothed volume has settled.
    pub dirty: bool,
    /// Set when an assignment was removed: the apply loop lifts the mute one last
    /// time and then drops the target, so an app can't be left muted by an
    /// assignment that no longer exists.
    pub pending_release: bool,
}

#[derive(Clone, Default)]
pub struct VolumeState {
    inner: Arc<Mutex<HashMap<String, AppVolumeTarget>>>,
    /// Apps to unmute that the loop isn't tracking — a mute that outlived the
    /// session it was set in, whose assignment has now been removed.
    pending_unmutes: Arc<Mutex<Vec<String>>>,
    curve: Arc<Mutex<VolumeCurve>>,
}

fn effective_target(value: u8, trim: f32, curve: VolumeCurve) -> f32 {
    resolve(
        LevelInput {
            position: value,
            trim,
            muted: false,
        },
        curve,
    )
    .scalar
}

impl VolumeState {
    /// Points every app on `control` at the position `value`, scaled by each
    /// app's trim. Used both by the MIDI callback and by live trim/mute edits
    /// from the UI, so there is only ever one way a target gets set. `notify`
    /// separates the two: only controller movement raises the overlay.
    pub fn set_targets(&self, control: u8, value: u8, apps: &[AppLevel], notify: bool) {
        let curve = *self.curve.lock().expect("volume state poisoned");
        let mut targets = self.inner.lock().expect("volume state poisoned");

        for level in apps {
            let target = effective_target(value, level.trim, curve);
            let key = normalize_app_name(&level.app);

            targets
                .entry(key)
                .and_modify(|existing| {
                    existing.target = target;
                    existing.control = control;
                    existing.value = value;
                    existing.trim = level.trim;
                    existing.muted = level.muted;
                    existing.notify = notify;
                    existing.dirty = true;
                    existing.pending_release = false;
                })
                .or_insert_with(|| AppVolumeTarget {
                    app: level.app.clone(),
                    target,
                    current: target,
                    control,
                    value,
                    trim: level.trim,
                    muted: level.muted,
                    notify,
                    dirty: true,
                    pending_release: false,
                });
        }
    }

    /// Swaps the response curve and re-aims everything already in flight, so the
    /// setting takes effect on whatever is playing instead of waiting for the next
    /// nudge of a control. Silent, like any other edit made in the UI.
    ///
    /// An unchanged curve is dropped on the floor. Every settings save sends the
    /// curve, and re-aiming on each one would re-assert a volume on every app the
    /// loop is tracking — overwriting anything the user had since set by hand in
    /// the Windows mixer, for a setting that did not move.
    pub fn set_curve(&self, curve: VolumeCurve) {
        {
            let mut stored = self.curve.lock().expect("volume state poisoned");

            if *stored == curve {
                return;
            }

            *stored = curve;
        }

        let mut targets = self.inner.lock().expect("volume state poisoned");

        for target in targets.values_mut() {
            target.target = effective_target(target.value, target.trim, curve);
            target.notify = false;
            target.dirty = true;
        }
    }

    /// The curve currently in force. Reported back so the UI can label levels with
    /// the same chain the audio thread is running, rather than its own idea of it.
    pub fn curve(&self) -> VolumeCurve {
        *self.curve.lock().expect("volume state poisoned")
    }

    /// The position a control was last driven to, if anything is still tracking it.
    pub fn control_value(&self, control: u8) -> Option<u8> {
        self.inner
            .lock()
            .expect("volume state poisoned")
            .values()
            .find(|target| target.control == control)
            .map(|target| target.value)
    }

    pub fn snapshot(&self) -> Vec<AppVolumeTarget> {
        self.inner
            .lock()
            .expect("volume state poisoned")
            .values()
            .cloned()
            .collect()
    }

    /// Queues a final unmute for apps whose assignment was just removed, so the
    /// apply loop can hand them back to Windows at their current volume.
    ///
    /// An app the loop isn't tracking still needs unmuting: a mute set before the
    /// last restart survives in the audio session itself, and once the assignment
    /// is gone there is nothing left in the UI to lift it.
    pub fn release(&self, apps: &[String]) {
        let mut targets = self.inner.lock().expect("volume state poisoned");
        let mut unmutes = self.pending_unmutes.lock().expect("volume state poisoned");

        for app in apps {
            match targets.get_mut(&normalize_app_name(app)) {
                Some(target) => {
                    target.muted = false;
                    target.notify = false;
                    target.dirty = true;
                    target.pending_release = true;
                }
                None => unmutes.push(app.clone()),
            }
        }
    }

    pub fn take_pending_unmutes(&self) -> Vec<String> {
        std::mem::take(&mut *self.pending_unmutes.lock().expect("volume state poisoned"))
    }

    pub fn remove(&self, app: &str) {
        self.inner
            .lock()
            .expect("volume state poisoned")
            .remove(&normalize_app_name(app));
    }

    /// Records what the apply loop just pushed to the mixer.
    ///
    /// `applied_target` and `applied_muted` are what the loop was working from.
    /// The loop reads a snapshot and applies it over the following moments, and a
    /// MIDI message or a UI edit can land in that gap — clearing `dirty`
    /// unconditionally would drop the edit on the floor, and a mute, which moves
    /// no volume for the convergence check to notice, would simply never be
    /// applied. So the flag is only lowered if the target is still the one that
    /// was acted on.
    pub fn set_current(&self, app: &str, current: f32, applied_target: f32, applied_muted: bool) {
        let key = normalize_app_name(app);
        if let Some(target) = self
            .inner
            .lock()
            .expect("volume state poisoned")
            .get_mut(&key)
        {
            let current = current.clamp(0.0, 1.0);
            target.current = current;

            if target.target == applied_target && target.muted == applied_muted {
                target.dirty = (current - target.target).abs() >= CONVERGED_EPSILON;
            }
        }
    }
}

pub fn normalize_app_name(app: &str) -> String {
    app.trim()
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_lowercase()
}
