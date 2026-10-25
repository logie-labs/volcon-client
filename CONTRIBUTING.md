# Contributing to Volcon

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Problems and ideas

Use the [issue forms](https://github.com/logie-labs/volcon-client/issues/new/choose).

For a bug, the quickest way in is **Settings → About → Report a problem** in Volcon. It fills in your versions and controllers for you.

Security problems are different: please report them privately, as [SECURITY.md](SECURITY.md) describes.

For anything bigger than a small fix, open an issue before a pull request, so the approach is agreed before you spend time on it.

## Setting up

You'll need Windows 10 or 11 with:

- [Node.js](https://nodejs.org) 20.9 or newer.
- [Rust](https://rustup.rs).
- The [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), with *Desktop development with C++*.

Tauri's [prerequisites guide](https://v2.tauri.app/start/prerequisites/) covers each of these.

```sh
git clone https://github.com/logie-labs/volcon-client.git
cd volcon-client
npm install
npm run dev
```

`npm run dev` serves the interface on `localhost:3000` and opens the app around it:

- Changes to the interface show straight away.
- Changes to the Rust side rebuild and restart the app.

## Checks

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint, including the React Compiler's rules |
| `cargo test --manifest-path src-tauri/Cargo.toml` | The backend |
| `npm run tauri build` | That the installer builds, into `src-tauri/target/release/bundle/nsis` |

CI runs the interface build, the typecheck, lint and the backend's tests on every pull request.

## How the code is written

- **Interface text** is plain and specific. It says what happened and what to do about it, in sentence case and UK spelling ("colour", "licence").
- **Comments** explain why, in the same plain words, rather than repeating what the code says.
- **React** code keeps to the React Compiler's rules that `npm run lint` checks. Don't set state in effects or read refs during render.
- **Styling** uses Tailwind and the theme's tokens, like `bg-card` and `text-muted-foreground`, rather than fixed colours. That way light and dark both work.
- **Settings** are declared in `components/sections/settings/settings-schema.ts`. A new setting needs:
  - an entry there;
  - a default, and how to read a saved value, in `settings-config.ts`;
  - a row on its page.
- **Formatting** is Prettier's. Run `npm run format` before committing.

## Releasing

For maintainers:

1. Set the new version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. Then run `cargo check --manifest-path src-tauri/Cargo.toml` to update `Cargo.lock`.
2. In `CHANGELOG.md`, write what's new under `## [x.y.z] - YYYY-MM-DD`.
3. Commit and push master, and wait for CI to pass. A pushed tag can't easily be taken back, so the tag comes after.
4. Tag and push it: `git tag -a vx.y.z -m "Volcon x.y.z"`, then `git push origin vx.y.z`.
5. The [Release workflow](.github/workflows/release.yml) does the rest:
   - It checks the tag matches all three versions, and that the changelog has notes for it.
   - It builds the installer.
   - It publishes the release, with the installer and the changelog's notes.

CI installs with the npm that comes with Node 24, which can read a lockfile differently from an older npm. If you change dependencies, update the lockfile with that npm, for example `npx npm@11.19.1 install`, or CI's `npm ci` may refuse it.

A version with a hyphen, like `v0.2.0-beta.1`, is published as a pre-release. Volcon only offers those to people who've turned on *Include pre-releases*.
