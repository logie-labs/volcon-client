use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::server::overlay::{OverlayNotifier, VolumeOverlayEvent};
use crate::server::state::{AppVolumeTarget, PeakMeters, VolumeState, CONVERGED_EPSILON};

#[cfg(windows)]
use std::collections::HashMap;
#[cfg(windows)]
use crate::server::process::ProcessDetails;
#[cfg(windows)]
use super::session_cache::SessionCache;
#[cfg(windows)]
use super::windows::initialize_audio_thread;

const TICK_INTERVAL: Duration = Duration::from_millis(16);
const CACHE_REFRESH_INTERVAL: Duration = Duration::from_millis(1500);
const SMOOTHING_ALPHA: f32 = 0.25;

/// How often the level meters are read while the UI is showing them - about as
/// often as the UI asks, and plenty for a meter that only has to look alive.
#[cfg(windows)]
const METER_INTERVAL: Duration = Duration::from_millis(30);

/// How long an unchanged app list may go without being re-sent to the overlay.
///
/// Every overlay frame carries one base64 PNG icon per affected app, so emitting
/// one per 16ms tick meant a control driving five apps pushed megabytes a second
/// through the webview bridge and starved the UI thread. The level itself still
/// reaches both windows instantly on `control:update`; this event only needs to
/// keep the overlay's icon row in sync, so it is sent when the app list changes
/// and then merely refreshed on this interval.
#[cfg(windows)]
const OVERLAY_REFRESH_INTERVAL: Duration = Duration::from_millis(750);

pub struct AudioApplyLoop {
    stopped: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl AudioApplyLoop {
    pub fn start(volume_state: VolumeState, overlay: OverlayNotifier, meters: PeakMeters) -> Self {
        let stopped = Arc::new(AtomicBool::new(false));
        let worker_stopped = Arc::clone(&stopped);
        let handle = thread::spawn(move || {
            run_apply_loop(volume_state, overlay, meters, worker_stopped)
        });

        Self {
            stopped,
            handle: Some(handle),
        }
    }
}

impl Drop for AudioApplyLoop {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

/// What the overlay was last told about a control, so an unchanged frame can be
/// dropped instead of re-serialised.
#[cfg(windows)]
struct OverlayFrame {
    pids: Vec<u32>,
    sent_at: Instant,
}

#[cfg(windows)]
fn run_apply_loop(
    volume_state: VolumeState,
    overlay: OverlayNotifier,
    meters: PeakMeters,
    stopped: Arc<AtomicBool>,
) {
    let Ok(_com) = initialize_audio_thread() else {
        return;
    };

    let cache = SessionCache::new(CACHE_REFRESH_INTERVAL);
    let mut next_tick = Instant::now();
    let mut last_overlay_frames: HashMap<u8, OverlayFrame> = HashMap::new();
    let mut next_meter_read = Instant::now();
    let mut metering = false;

    while !stopped.load(Ordering::Relaxed) {
        next_tick += TICK_INTERVAL;

        // Level meters run only while the UI is showing them. Going off releases
        // every meter the cache holds and forgets the last reading, so nothing
        // is read, held or kept for a meter nobody is looking at.
        let want_meters = meters.wanted();
        if want_meters != metering {
            cache.set_metering(want_meters);
            if !want_meters {
                meters.clear();
            }
            metering = want_meters;
        }

        if let Err(err) = cache.refresh_if_due() {
            log::warn!("couldn't refresh audio sessions: {err}");
        }

        for app in volume_state.take_pending_unmutes() {
            if let Err(err) = cache.unmute(&app) {
                log::warn!("couldn't unmute {app}: {err}");
            }
        }

        if metering {
            let now = Instant::now();
            if now >= next_meter_read {
                meters.publish(cache.peaks());
                next_meter_read = now + METER_INTERVAL;
            }
        }

        let targets = volume_state.snapshot();
        if !targets.is_empty() {
            apply_targets(
                &volume_state,
                &overlay,
                &cache,
                targets,
                &mut last_overlay_frames,
            );
        }

        let now = Instant::now();
        if next_tick > now {
            thread::sleep(next_tick - now);
        } else {
            next_tick = now;
        }
    }
}

#[cfg(not(windows))]
fn run_apply_loop(
    _volume_state: VolumeState,
    _overlay: OverlayNotifier,
    _meters: PeakMeters,
    stopped: Arc<AtomicBool>,
) {
    while !stopped.load(Ordering::Relaxed) {
        thread::sleep(TICK_INTERVAL);
    }
}

#[cfg(windows)]
fn apply_targets(
    volume_state: &VolumeState,
    overlay: &OverlayNotifier,
    cache: &SessionCache,
    targets: Vec<AppVolumeTarget>,
    last_overlay_frames: &mut HashMap<u8, OverlayFrame>,
) {
    // Group by control so that a control mapped to multiple apps (e.g. a control shared by
    // Spotify and Discord) emits one overlay event listing every affected app, instead of one
    // event per app that stomps the previous app's icon out of the overlay.
    let mut by_control: HashMap<u8, Vec<AppVolumeTarget>> = HashMap::new();
    for target in targets {
        by_control.entry(target.control).or_default().push(target);
    }

    for (control, group) in by_control {
        let mut combined_apps: Vec<ProcessDetails> = Vec::new();
        let mut seen_pids = std::collections::HashSet::new();
        let mut latest_value = 0u8;
        let mut any_applied = false;
        let mut any_notifies = false;

        for target in group {
            if !target.dirty && (target.current - target.target).abs() < CONVERGED_EPSILON {
                continue;
            }

            let current = smooth(target.current, target.target);
            volume_state.set_current(&target.app, current, target.target, target.muted);

            latest_value = target.value;
            any_notifies = any_notifies || target.notify;

            log::trace!(
                "{} at {:.3} (heading for {:.3}{})",
                target.app,
                current,
                target.target,
                if target.muted { ", muted" } else { "" }
            );

            match cache.apply_volume(&target.app, current, target.muted) {
                Ok(apps) => {
                    for app in apps {
                        if seen_pids.insert(app.pid) {
                            any_applied = true;
                            combined_apps.push(app);
                        }
                    }
                }
                Err(err) => log::warn!("couldn't set the volume of {}: {err}", target.app),
            }

            if target.pending_release {
                volume_state.remove(&target.app);
            }
        }

        // A trim or mute edit still moves the mixer, it just doesn't announce itself.
        if !any_applied || !any_notifies {
            continue;
        }

        // The control's own position, not an individual app's smoothed volume — with
        // trim in play the apps sit at different levels, and the overlay is showing
        // where the control is.
        let latest_volume = ((latest_value as f32 / 127.0) * 100.0).round() as u8;

        let mut pids: Vec<u32> = combined_apps.iter().map(|app| app.pid).collect();
        pids.sort_unstable();

        let now = Instant::now();
        let should_emit = match last_overlay_frames.get(&control) {
            Some(previous) => {
                previous.pids != pids || now.duration_since(previous.sent_at) >= OVERLAY_REFRESH_INTERVAL
            }
            None => true,
        };

        if !should_emit {
            continue;
        }

        last_overlay_frames.insert(control, OverlayFrame { pids, sent_at: now });

        overlay.emit_volume_change(VolumeOverlayEvent {
            control,
            value: latest_value,
            volume: latest_volume,
            apps: combined_apps,
        });
    }
}

#[cfg(windows)]
fn smooth(current: f32, target: f32) -> f32 {
    let next = current + (target - current) * SMOOTHING_ALPHA;
    if (target - next).abs() < CONVERGED_EPSILON {
        target
    } else {
        next.clamp(0.0, 1.0)
    }
}
