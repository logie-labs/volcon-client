use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{IAudioSessionControl2, ISimpleAudioVolume};

use crate::server::error::BridgeResult;
use crate::server::process::{process_details, process_name, ProcessDetails};
use crate::server::state::{normalize_app_name, ChannelPeaks};

use super::windows::session_enumerator;

struct CachedSession {
    volume: ISimpleAudioVolume,
    /// The session's own peak meter, for the UI's level meters. Optional because
    /// a session that won't hand one over can still have its volume set.
    meter: Option<IAudioMeterInformation>,
    details: ProcessDetails,
}

impl CachedSession {
    /// The session's current peak on each side. Stereo is the usual case; a mono
    /// session shows the same level on both, and a meter that can't report its
    /// channels falls back to its overall peak.
    fn peaks(&self) -> Option<ChannelPeaks> {
        let meter = self.meter.as_ref()?;
        let channels = unsafe { meter.GetMeteringChannelCount() }.unwrap_or(0) as usize;

        let peaks = if channels >= 2 {
            // Front left and front right come first whatever the layout, so a
            // surround session still reads sensibly as left and right.
            let mut values = vec![0.0_f32; channels];
            unsafe { meter.GetChannelsPeakValues(&mut values) }.ok()?;
            ChannelPeaks {
                left: values[0],
                right: values[1],
            }
        } else {
            ChannelPeaks::mono(unsafe { meter.GetPeakValue() }.ok()?)
        };

        Some(peaks.sanitized())
    }
}

pub struct SessionCache {
    sessions: RefCell<HashMap<String, Vec<CachedSession>>>,
    refresh_interval: Duration,
    next_refresh: RefCell<Instant>,
    /// Whether to hold each session's peak meter. Off unless the UI is showing
    /// level meters, so the cache asks Windows for nothing it isn't going to read.
    metering: Cell<bool>,
}

impl SessionCache {
    pub fn new(refresh_interval: Duration) -> Self {
        Self {
            sessions: RefCell::new(HashMap::new()),
            refresh_interval,
            next_refresh: RefCell::new(Instant::now()),
            metering: Cell::new(false),
        }
    }

    /// Starts or stops holding peak meters. Turning on rescans straight away so
    /// the first reading isn't up to a refresh late; turning off releases every
    /// meter the cache holds, there and then.
    pub fn set_metering(&self, on: bool) {
        if self.metering.replace(on) == on {
            return;
        }

        if on {
            *self.next_refresh.borrow_mut() = Instant::now();
            return;
        }

        for app_sessions in self.sessions.borrow_mut().values_mut() {
            for session in app_sessions {
                session.meter = None;
            }
        }
    }

    pub fn refresh_if_due(&self) -> BridgeResult<()> {
        let now = Instant::now();
        if now < *self.next_refresh.borrow() {
            return Ok(());
        }

        self.refresh()?;
        *self.next_refresh.borrow_mut() = now + self.refresh_interval;
        Ok(())
    }

    pub fn refresh(&self) -> BridgeResult<()> {
        let sessions = session_enumerator()?;
        let count = unsafe { sessions.GetCount()? };
        let mut cache: HashMap<String, Vec<CachedSession>> = HashMap::new();

        for index in 0..count {
            let Ok(control) = (unsafe { sessions.GetSession(index) }) else {
                continue;
            };
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
                continue;
            };
            let Ok(pid) = (unsafe { control2.GetProcessId() }) else {
                continue;
            };
            if pid == 0 {
                continue;
            }

            let Some(name) = process_name(pid) else {
                continue;
            };
            let Ok(volume) = control.cast::<ISimpleAudioVolume>() else {
                continue;
            };
            let Ok(details) = process_details(pid) else {
                continue;
            };
            let meter = if self.metering.get() {
                control.cast::<IAudioMeterInformation>().ok()
            } else {
                None
            };

            cache
                .entry(normalize_app_name(&name))
                .or_default()
                .push(CachedSession {
                    volume,
                    meter,
                    details,
                });
        }

        *self.sessions.borrow_mut() = cache;
        Ok(())
    }

    /// Every app's current peak on each side, the loudest of its sessions. Apps
    /// whose sessions have no meter are left out, and read as silence.
    pub fn peaks(&self) -> HashMap<String, ChannelPeaks> {
        let sessions = self.sessions.borrow();
        let mut peaks = HashMap::with_capacity(sessions.len());

        for (app, app_sessions) in sessions.iter() {
            let loudest = app_sessions
                .iter()
                .filter_map(CachedSession::peaks)
                .reduce(ChannelPeaks::max);

            if let Some(loudest) = loudest {
                peaks.insert(app.clone(), loudest);
            }
        }

        peaks
    }

    /// Lifts a mute without touching the volume, for an app that is on its way out
    /// of the loop's hands.
    pub fn unmute(&self, app: &str) -> BridgeResult<()> {
        let sessions = self.sessions.borrow();
        let Some(app_sessions) = sessions.get(&normalize_app_name(app)) else {
            return Ok(());
        };

        for session in app_sessions {
            unsafe { session.volume.SetMute(false, std::ptr::null())? };
        }

        Ok(())
    }

    pub fn apply_volume(
        &self,
        app: &str,
        volume: f32,
        muted: bool,
    ) -> BridgeResult<Vec<ProcessDetails>> {
        let sessions = self.sessions.borrow();
        let Some(app_sessions) = sessions.get(&normalize_app_name(app)) else {
            return Ok(Vec::new());
        };

        let mut seen = HashSet::new();
        let mut changed = Vec::new();

        for session in app_sessions {
            // Mute is the session's own mute flag rather than a volume of zero, so a
            // muted app shows as muted in the Windows volume mixer and keeps the level
            // it will come back to when unmuted.
            unsafe { session.volume.SetMute(muted, std::ptr::null())? };
            unsafe {
                session
                    .volume
                    .SetMasterVolume(volume.clamp(0.0, 1.0), std::ptr::null())?
            };

            if seen.insert(session.details.pid) {
                changed.push(session.details.clone());
            }
        }

        changed.sort_by_key(|details| details.name.to_lowercase());
        Ok(changed)
    }
}
