# Contributing

Thanks for taking the time to contribute! This document covers the basics for developing, testing, and submitting changes to **GitLab MR Monitor & Creator**.

## Getting started

```bash
git clone git@github.com:RiteshWanave/vsc-gitlab-mr.git
cd vsc-gitlab-mr
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host (this runs the extension against a test window).

## Project layout

- `src/extension.ts` – activation, command registration, refresh loop
- `src/mrViewProvider.ts` – the MR cards webview (rendered in the activity bar)
- `src/monitor.ts` – fetching and enriching MR data (pipelines, approvals, comments)
- `src/gitlab.ts` – GitLab REST API client (`/api/v4`)
- `src/createMr.ts` – the create/edit MR form (template parsing, conventional commits)
- `src/comments.ts` – inline review comments via the VS Code Comments API
- `src/repo.ts` – git helpers (root detection, branch, remote parsing)
- `src/config.ts` – settings and secret/token access

## Before you submit

- **Type-check**: `npm run compile` must pass with no errors (`strict`, `noUnusedLocals`, `noUnusedParameters`).
- **Lint**: `npm run lint` must pass.
- **Tests**: `npm test` runs the unit tests (pure helpers only, no VS Code host required).
- Add tests for any pure logic you change (template parsing, placeholder replacement, remote parsing).

## Reporting bugs & ideas

Open an issue on the [issue tracker](https://github.com/RiteshWanave/vsc-gitlab-mr/issues). Include your VS Code version, the extension version, and what you expected vs. what happened. For security-related issues, follow [SECURITY.md](SECURITY.md).

## Code style

- TypeScript, strict mode.
- No comments unless they explain *why* (the code should be self-explanatory).
- Keep pull requests small and focused; prefer several small PRs over one large one.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
