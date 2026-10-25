use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::volume::normalize_app_name;

/// How long metering carries on after the UI last asked for levels. The UI asks
/// many times a second while a meter is on screen, so this only has to bridge
/// the gap between two polls - and it means a closed window, a hidden screen or
/// meters turned off in Settings stop the audio thread reading them within a
/// moment, without anything having to say so.
const WANTED_FOR: Duration = Duration::from_millis(1500);

/// The loudest sample each side of an app's audio reached in the last moment,
/// as linear amplitudes from 0 (silence) to 1 (full scale).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ChannelPeaks {
    pub left: f32,
    pub right: f32,
}

impl ChannelPeaks {
    /// The same level on both sides, for audio that only has one channel.
    pub fn mono(peak: f32) -> Self {
        Self {
            left: peak,
            right: peak,
        }
    }

    /// The louder of two readings on each side - an app with several audio
    /// sessions is as loud as its loudest one.
    pub fn max(self, other: Self) -> Self {
        Self {
            left: self.left.max(other.left),
            right: self.right.max(other.right),
        }
    }

    /// Out-of-range or garbage readings, which a driver can produce, pinned to
    /// something the meters can draw.
    pub fn sanitized(self) -> Self {
        let clean = |peak: f32| {
            if peak.is_finite() {
                peak.clamp(0.0, 1.0)
            } else {
                0.0
            }
        };

        Self {
            left: clean(self.left),
            right: clean(self.right),
        }
    }
}

#[derive(Default)]
struct MeterState {
    /// Keyed by normalized app name, the same key the session cache uses.
    peaks: HashMap<String, ChannelPeaks>,
    wanted_until: Option<Instant>,
}

/// Live audio levels for the UI's meters.
///
/// Written by the audio thread, which owns the sessions, and read by the bridge
/// when the UI polls - so a poll never touches Windows audio itself, and reading
/// the meters costs the audio thread nothing while nobody is looking at them.
#[derive(Clone, Default)]
pub struct PeakMeters {
    inner: Arc<Mutex<MeterState>>,
}

impl PeakMeters {
    /// The latest levels for `apps`, in the order asked, and a note that the UI
    /// is watching so the audio thread keeps them fresh. An app with nothing
    /// playing, or no audio session at all, reads as silence.
    pub fn read(&self, apps: &[String]) -> Vec<(String, ChannelPeaks)> {
        self.read_at(apps, Instant::now())
    }

    fn read_at(&self, apps: &[String], now: Instant) -> Vec<(String, ChannelPeaks)> {
        let mut state = self.inner.lock().expect("meter state poisoned");
        state.wanted_until = Some(now + WANTED_FOR);

        apps.iter()
            .map(|app| {
                let peaks = state
                    .peaks
                    .get(&normalize_app_name(app))
                    .copied()
                    .unwrap_or_default();

                (app.clone(), peaks)
            })
            .collect()
    }

    /// Whether anything has asked for levels recently enough to be worth reading.
    pub fn wanted(&self) -> bool {
        self.wanted_at(Instant::now())
    }

    fn wanted_at(&self, now: Instant) -> bool {
        self.inner
            .lock()
            .expect("meter state poisoned")
            .wanted_until
            .is_some_and(|until| now < until)
    }

    /// Replaces every level with a fresh reading from the audio thread.
    pub fn publish(&self, peaks: HashMap<String, ChannelPeaks>) {
        self.inner.lock().expect("meter state poisoned").peaks = peaks;
    }

    /// Forgets the last reading, so a meter that comes back after a while starts
    /// from silence rather than from whatever was playing when it last looked.
    pub fn clear(&self) {
        self.inner.lock().expect("meter state poisoned").peaks.clear();
    }

    /// Metering off, now: the UI has no meter on screen any more, or the meters
    /// were turned off in Settings. The audio thread stops reading on its next
    /// tick and lets go of the meters it was holding, rather than waiting out
    /// the grace period a forgotten window relies on.
    pub fn stop(&self) {
        let mut state = self.inner.lock().expect("meter state poisoned");
        state.wanted_until = None;
        state.peaks.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_by_normalized_name_in_the_order_asked() {
        let meters = PeakMeters::default();
        meters.publish(HashMap::from([
            ("spotify".to_owned(), ChannelPeaks { left: 0.5, right: 0.25 }),
            ("discord".to_owned(), ChannelPeaks::mono(0.1)),
        ]));

        let read = meters.read(&["Discord.exe".to_owned(), "Spotify".to_owned()]);

        assert_eq!(read[0], ("Discord.exe".to_owned(), ChannelPeaks::mono(0.1)));
        assert_eq!(
            read[1],
            ("Spotify".to_owned(), ChannelPeaks { left: 0.5, right: 0.25 })
        );
    }

    #[test]
    fn an_app_without_a_reading_is_silent() {
        let meters = PeakMeters::default();

        assert_eq!(
            meters.read(&["chrome".to_owned()]),
            vec![("chrome".to_owned(), ChannelPeaks::default())]
        );
    }

    #[test]
    fn wanted_only_for_a_while_after_a_read() {
        let meters = PeakMeters::default();
        let start = Instant::now();

        assert!(!meters.wanted_at(start));

        meters.read_at(&[], start);
        assert!(meters.wanted_at(start + Duration::from_millis(100)));
        assert!(!meters.wanted_at(start + WANTED_FOR + Duration::from_millis(1)));
    }

    #[test]
    fn the_louder_session_wins_on_each_side() {
        let combined = ChannelPeaks { left: 0.2, right: 0.9 }.max(ChannelPeaks { left: 0.6, right: 0.1 });

        assert_eq!(combined, ChannelPeaks { left: 0.6, right: 0.9 });
    }

    #[test]
    fn garbage_readings_are_pinned_to_range() {
        let clean = ChannelPeaks { left: f32::NAN, right: 3.0 }.sanitized();

        assert_eq!(clean, ChannelPeaks { left: 0.0, right: 1.0 });
    }

    #[test]
    fn stop_ends_metering_at_once_and_forgets_the_reading() {
        let meters = PeakMeters::default();
        meters.publish(HashMap::from([("spotify".to_owned(), ChannelPeaks::mono(0.7))]));
        let now = Instant::now();
        meters.read_at(&[], now);

        meters.stop();

        assert!(!meters.wanted_at(now));
        assert_eq!(meters.inner.lock().unwrap().peaks.len(), 0);
    }

    #[test]
    fn clear_forgets_the_last_reading() {
        let meters = PeakMeters::default();
        meters.publish(HashMap::from([("spotify".to_owned(), ChannelPeaks::mono(0.7))]));
        meters.clear();

        assert_eq!(meters.read(&["spotify".to_owned()])[0].1, ChannelPeaks::default());
    }
}
