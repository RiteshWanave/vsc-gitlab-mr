# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.5] - 2026-08-15

### Added
- Conventional-commit title builder when the project root has a `conventionalCommits.json` (`requireScopes` + `scopes`); type and scope are picked from drop-downs and the title is composed as `type(scope): description`.
- Generic template-placeholder support: `PUT ID HERE` / `<PUT_ID_HERE>`-style tokens in MR templates become input fields and are substituted when creating an MR (replaces the hard-coded Polarion ID field).
- Inline GitLab review comments in the editor (VS Code Comments API), anchored to the current branch's lines, with author name + `@username` and relative timestamps.
- "Run new pipeline" now starts a proper MR pipeline via `POST /projects/:id/merge_requests/:iid/pipelines`.
- First-run setup prompts for the GitLab server URL (once) and the personal access token.
- Open-source hardening: `gitlabMr.baseUrl` defaults to `https://gitlab.com`, tokens are stored only in VS Code secure secrets, and all internal references were removed from the codebase.

### Changed
- Comment timestamps render as relative times ("2h ago").
- The extension's icon size for card link actions was increased.

### Removed
- GitHub Copilot "fix" action on comments.
- Pipeline trigger-token setting and all trigger-token logic (MR-pipeline endpoint is used instead).
- Token file reading (`~/.gitlab_token`).

## [0.0.4] - 2026-08-14

### Added
- Expandable pipeline badge showing all stages and jobs; per-job Play/Retry.
- Retry failed pipeline action.
- Compact card layout.

## [0.0.3] - 2026-08-13

### Added
- Webview-based MR cards (replaced the tree view).
- Edit-description flow (title + markdown description).
- Approvals progress, merge-conflict warning, review-comment counts.
