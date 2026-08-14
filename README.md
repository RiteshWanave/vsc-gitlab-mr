# GitLab MR Monitor & Creator

Monitor GitLab merge requests from the activity bar and create merge requests for the current branch using the templates in `.gitlab/merge_request_templates`.

## Features

- **Monitor**: shows your **open** merge requests for the **current project** (detected from the git remote) as compact **cards** – pipeline status + stage, merge-conflict warning, and an **approvals (approved / required)** pill. Click a card title to open the MR in the browser.
- **Pipeline details**: click the **pipeline** badge to expand **all stages and jobs**; failing jobs can be **retried** individually, manual jobs show a **Play** button, failed pipelines offer **Retry failed** and **Run new pipeline** (restart the whole pipeline on the MR branch).
- **Copy**: per-MR **copy link** button, plus a **Copy all MRs** button on top.
- **Edit after creation**: each card has an **Edit description** action that opens a prefilled form (title + markdown description) and updates the MR in place.
- **Inline review comments**: when your current branch has an open MR, its GitLab code-review comments are shown **anchored to the exact lines in the editor** (VS Code Comments API — gutter + Comments panel). System/bot notes are skipped. Toggle with the `gitlabMr.showCommentsInEditor` setting.
- **Create MR**: creates a merge request from the current branch. It reads the repository's `.gitlab/merge_request_templates` folder and shows a **form** to fill in the description, changes, testing and checklist sections, quick actions from the template, and any placeholders in the template (e.g. `PUT ID HERE`) as dedicated input fields. If the project root contains a `conventionalCommits.json` (with `requireScopes` and a `scopes` list), the title is built as a conventional commit (`type(scope): description`) with the type and scope picked from drop-downs.
- **Notifications**: desktop toast (and OS popup for critical events) when a new comment arrives, a pipeline status changes, or a merge conflict appears.

## Commands

| Command | Description |
| --- | --- |
| `GitLab MR: Refresh` | Refresh the MR list |
| `GitLab MR: Create Merge Request from current branch` | Start the MR creation wizard |
| `GitLab MR: Set GitLab Token` | Store your GitLab personal access token (kept in VS Code secrets) |

## Configuration

- `gitlabMr.baseUrl` – GitLab instance base URL (default: `https://gitlab.com`).
- `gitlabMr.refreshIntervalMinutes` – auto-refresh interval in minutes (default 5).
- `gitlabMr.notifyDesktop` – also fire OS desktop popups for critical events (default true).
- `gitlabMr.showCommentsInEditor` – show the open MR's review comments inline in the editor (default true).

## Token

The extension stores the GitLab personal access token in **VS Code's secure secret storage**. On first activation it asks for the token; you can also set it anytime with the **`GitLab MR: Set GitLab Token`** command. Tokens are never written to disk by the extension.
