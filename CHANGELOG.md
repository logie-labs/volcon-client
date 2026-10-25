# Changelog

Every release of Volcon, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Each version's notes here become its release notes on GitHub, and what Volcon shows under *What's new* on Settings → Updates.

## [0.1.3] - 2026-10-25

### Added

- Updates download and install from inside Volcon. Download a new version on Settings → Updates and watch it come in, then update now - Volcon closes for a moment and opens again - or leave it to install the next time Volcon starts. Each download is checked against the release before it's used, and installs over the old version without uninstalling it first.
- Skip a version you don't want, and Volcon stops offering it.
- Settings → Backup & reset can reset assignments, taking every app off every control on every preset, or reset everything, back to a fresh install.

### Fixed

- Launch with Windows no longer flips on and off by itself, or says it couldn't change. It also keeps working after an update moves Volcon.
- Volcon no longer says the version you've just installed is available.
- An app no longer warns that it's also controlled by a control on another preset. Assignments left over like that, which a control could still quietly move, are cleared.

## [0.1.2] - 2026-10-25

Not released: its build failed before anything was published. Everything meant for it is in 0.1.3.

## [0.1.1] - 2026-10-25

### Fixed

- Settings → About names an installed version by the commit it was built from, and nothing more. *+ changes* now only shows in development builds, and goes by the code as it stands.

## [0.1.0] - 2026-10-25

The first release.

### Added

- Control the volume of any app from a MIDI controller: learn a knob or fader by moving it, then give it the apps it should set.
- More than one app on a control, with trim to balance them against each other, and a mute for each.
- Presets, each with its own controller and mappings, to switch between setups.
- A logarithmic response with an adjustable strength, and a deadzone that ignores a jittery knob at rest.
- An on-screen overlay that shows the level as a control moves, with its corner, size, spacing and timing up to you.
- Live level meters for every app, and the level of the mapping you're on in the title bar.
- Notifications that explain what happened, from controllers coming and going to apps handed back to Windows, with undo wherever a change can be taken back.
- A command menu, on Ctrl + Alt, for getting anywhere and doing most things from the keyboard.
- Starting with Windows and in the tray, and closing to the tray.
- Light and dark themes, or whichever Windows is using.
- Settings backups you can export and import, and resets you can undo.
- A check for new versions on GitHub, at most once a day, with what's new in them.
- Report a problem, on Settings → About, which starts a bug report with your versions filled in.

[0.1.3]: https://github.com/logie-labs/volcon-client/releases/tag/v0.1.3
[0.1.1]: https://github.com/logie-labs/volcon-client/releases/tag/v0.1.1
[0.1.0]: https://github.com/logie-labs/volcon-client/releases/tag/v0.1.0
