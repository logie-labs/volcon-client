//! Things handed to Windows rather than done in the app: saving a file to
//! Downloads, showing a file in Explorer, and opening a web page in the
//! browser.

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager, Runtime};

/// The sites the app links to: GitHub, for Volcon's own code, issues, commits
/// and releases, and the projects credited on the About page. Anything else is
/// refused, so the command can't be used to launch whatever a page asks for.
const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "tauri.app",
    "react.dev",
    "nextjs.org",
    "serde.rs",
    "base-ui.com",
    "ui.shadcn.com",
    "tailwindcss.com",
    "motion.dev",
    "cmdk.paco.me",
    "dndkit.com",
    "reactbits.dev",
    "motion-primitives.com",
    "magicui.design",
    "threejs.org",
    "remixicon.com",
    "lucide.dev",
    "vercel.com",
    "fonts.google.com",
];

/// Whether `url` is a web page on one of the app's sites: `https://` only, no
/// characters a command line could misread, and exactly an allowed host - so
/// `github.com.example.org` isn't GitHub.
fn is_app_link(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };

    if url.len() > 4096
        || url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '"' | '<' | '>' | '\\' | '^' | '|' | '`'))
    {
        return false;
    }

    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    ALLOWED_HOSTS.contains(&host)
}

/// Writes a settings backup to the Downloads folder and answers with where it
/// went. An existing file is never overwritten: a second export the same day
/// gets " (2)" on the end, and so on.
#[tauri::command]
pub fn save_settings_backup<R: Runtime>(
    app: AppHandle<R>,
    file_name: String,
    contents: String,
) -> Result<String, String> {
    if !is_plain_json_name(&file_name) {
        return Err(format!("'{file_name}' isn't a file name a backup can have"));
    }

    let dir = app.path().download_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;

    let path = unused_path(&dir, &file_name);
    std::fs::write(&path, contents)
        .map_err(|err| format!("couldn't write {}: {err}", path.display()))?;

    log::info!("settings exported to {}", path.display());
    Ok(path.display().to_string())
}

/// Opens Explorer with the file selected.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);

    if !path.exists() {
        return Err(format!("{} no longer exists", path.display()));
    }

    // Explorer wants `/select,` and the path as one argument.
    let mut select = std::ffi::OsString::from("/select,");
    select.push(path.as_os_str());

    Command::new("explorer")
        .arg(select)
        .spawn()
        .map_err(|err| err.to_string())?;

    Ok(())
}

/// Opens one of the app's links in the default browser.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !is_app_link(&url) {
        return Err(format!("{url} isn't one of the app's links"));
    }

    Command::new("explorer")
        .arg(&url)
        .spawn()
        .map_err(|err| err.to_string())?;

    Ok(())
}

/// A bare `.json` file name: no folders, nothing Windows reserves.
fn is_plain_json_name(name: &str) -> bool {
    name.len() <= 128
        && name.ends_with(".json")
        && name.len() > ".json".len()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
        && !name.starts_with('.')
}

/// `dir/name`, or `dir/name (2)`, `(3)` and so on if it's taken.
fn unused_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);

    if !first.exists() {
        return first;
    }

    let stem = name.trim_end_matches(".json");

    (2..)
        .map(|n| dir.join(format!("{stem} ({n}).json")))
        .find(|path| !path.exists())
        .expect("some numbered name is free")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_json_names_are_accepted() {
        assert!(is_plain_json_name("volcon-settings-2026-10-24.json"));
        assert!(!is_plain_json_name("../evil.json"));
        assert!(!is_plain_json_name("C:\\Windows\\evil.json"));
        assert!(!is_plain_json_name("settings.exe"));
        assert!(!is_plain_json_name(".json"));
        assert!(!is_plain_json_name(".hidden.json"));
    }

    #[test]
    fn taken_names_get_a_number() {
        let dir = std::env::temp_dir().join(format!("volcon-shell-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let first = unused_path(&dir, "backup.json");
        assert_eq!(first, dir.join("backup.json"));
        std::fs::write(&first, "{}").unwrap();

        let second = unused_path(&dir, "backup.json");
        assert_eq!(second, dir.join("backup (2).json"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_the_apps_links_open() {
        assert!(open_external("https://example.com".into()).is_err());
        assert!(open_external("calc.exe".into()).is_err());
    }

    #[test]
    fn links_are_judged_by_scheme_and_exact_host() {
        assert!(is_app_link("https://github.com/logie-labs/volcon-client"));
        assert!(is_app_link(
            "https://github.com/logie-labs/volcon-client/issues/new?title=&body=%23%23%23+What+happened%3F%0A"
        ));
        assert!(is_app_link("https://github.com/logie-labs/volcon-client/commit/0726beb"));
        assert!(is_app_link("https://tauri.app"));
        assert!(is_app_link("https://fonts.google.com/specimen/Manrope"));

        assert!(!is_app_link("http://github.com/logie-labs/volcon-client"));
        assert!(!is_app_link("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_app_link("https://github.com.example.org/phish"));
        assert!(!is_app_link("https://example.com/?next=https://github.com"));
        assert!(!is_app_link("https://github.com/a b"));
        assert!(!is_app_link("https://github.com/\\..\\calc.exe"));
        assert!(!is_app_link("https://user@github.com/"));
    }
}
