# Security

## Reporting a problem

Please don't report a security problem in a public issue. Report it privately through [GitHub's private vulnerability reporting](https://github.com/logie-labs/volcon-client/security/advisories/new) instead. Include:

- what the problem is;
- how to make it happen;
- what someone could do with it.

The conversation stays private there until a fixed version is out.

## Supported versions

Fixes go into the latest release only, so please check the problem is still there in it.

## What Volcon can reach

To help judge what counts as a problem, this is everything Volcon touches outside its own window:

- Other apps' volume, through Windows' audio session API.
- Running apps' names, paths and icons, to show which app is which.
- MIDI input from the controller you choose.
- Its own presets, settings and logs, and settings backups it saves to your Downloads folder and can show in Explorer.
- Its entry in Windows' startup apps, when *Launch with Windows* is on.
- Your browser, which it opens only for links to its own and its credited projects' websites.
- The internet, for updates only: GitHub's list of Volcon's releases, to check for a newer version, and a release's installer when you download it. The installer is only ever fetched from Volcon's own releases and checked against the SHA-256 GitHub lists before it runs.
