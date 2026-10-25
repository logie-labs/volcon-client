/**
 * Where Volcon lives on GitHub: its code, its issues, and the releases the
 * update check reads. Everything that links out goes through here, so moving
 * the repository is one change.
 *
 * The repository isn't public yet. Until it is, the links lead to GitHub's
 * "not found" page and the update check finds nothing to compare against; both
 * say so rather than failing loudly, and both start working the day it opens.
 */

export const repository = {
  owner: "logie-labs",
  name: "volcon-client",
}

export const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`

/**
 * The bug report form, with its "This PC" answer already written. The form is
 * `.github/ISSUE_TEMPLATE/bug_report.yml`, and GitHub fills a form's fields
 * from query parameters named after their ids - so `this-pc` here has to stay
 * that field's id there.
 */
export function bugReportUrl(thisPc: string) {
  const query = new URLSearchParams({ template: "bug_report.yml", "this-pc": thisPc })
  return `${repositoryUrl}/issues/new?${query}`
}

/** One commit, on GitHub. */
export function commitUrl(commit: string) {
  return `${repositoryUrl}/commit/${commit}`
}

/** Every release, newest first, from GitHub's API. */
export const releasesApiUrl = `https://api.github.com/repos/${repository.owner}/${repository.name}/releases?per_page=30`
