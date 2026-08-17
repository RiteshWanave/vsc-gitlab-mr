import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { GitLabClient } from './gitlab';
import { getBaseUrl, getToken, getRefreshMinutes, getNotifyDesktop, setToken, setBaseUrl, isBaseUrlConfigured, getShowCommentsInEditor } from './config';
import { MrMonitor, MonitorEvent, EnrichedMR } from './monitor';
import { MrViewProvider } from './mrViewProvider';
import { MrCommentProvider } from './comments';
import { createMrFlow, editMrFlow } from './createMr';
import { getOriginUrl, projectPathFromRemote, getBranch } from './repo';
import { findGitRoot } from './workspace';

export function activate(context: vscode.ExtensionContext): void {
  let gitlab: GitLabClient | null = null;
  let commentProvider: MrCommentProvider | null = null;

  const SELECTED_PROJECT_KEY = 'gitlabMr.selectedProject';

  function getSelectedProject(): { path: string; name: string } | undefined {
    return context.globalState.get<{ path: string; name: string }>(
      SELECTED_PROJECT_KEY
    );
  }

  function execFileP(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(String(stdout));
        }
      });
    });
  }

  const provider = new MrViewProvider({
    onRefresh: () => void refresh(true),
    onRefreshLight: () => void refresh(false),
    onEdit: (mr) => void editSelectedMr(mr),
    onRetryPipeline: (mr, pipelineId) => void retryMrPipeline(mr, pipelineId),
    onPlayJob: (mr, jobId) => void playMrJob(mr, jobId),
    onRetryJob: (mr, jobId) => void retryMrJob(mr, jobId),
    onCreatePipeline: (mr) => void runNewMrPipeline(mr),
    onStartPipeline: (mr, jobIds) => void startMrPipeline(mr, jobIds),
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('gitlabMr.mrView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  void promptSetup(context);

  async function promptSetup(ctx: vscode.ExtensionContext): Promise<void> {
    if (!ctx.globalState.get<boolean>('gitlabMr.baseUrlAsked', false)) {
      await ctx.globalState.update('gitlabMr.baseUrlAsked', true);
      if (!isBaseUrlConfigured()) {
        const url = await vscode.window.showInputBox({
          title: 'GitLab server URL',
          value: 'https://gitlab.com',
          prompt: 'Enter the base URL of your GitLab server (you can change it later in Settings)',
        });
        if (url !== undefined && url.trim()) {
          try {
            await setBaseUrl(url.trim());
          } catch {
            // non-fatal – default applies
          }
        }
      }
    }
    const token = await getToken(ctx);
    if (!token) {
      const tok = await vscode.window.showInputBox({
        title: 'GitLab personal access token',
        password: true,
        prompt: 'Enter a GitLab personal access token (stored securely in VS Code)',
      });
      if (tok !== undefined && tok.trim()) {
        await setToken(ctx, tok.trim());
      }
    }
  }

  async function ensureClient(): Promise<GitLabClient | null> {
    if (gitlab) {
      return gitlab;
    }
    const token = await getToken(context);
    if (!token) {
      const answer = await vscode.window.showWarningMessage(
        'GitLab MR: no token configured. Set one to monitor and create merge requests.',
        'Set Token'
      );
      if (answer === 'Set Token') {
        await setTokenCommand();
        return ensureClient();
      }
      return null;
    }
    gitlab = new GitLabClient(getBaseUrl(), token);
    if (!commentProvider) {
      commentProvider = new MrCommentProvider(gitlab);
    }
    return gitlab;
  }

  async function setTokenCommand(): Promise<void> {
    const token = await vscode.window.showInputBox({
      title: 'GitLab personal access token',
      password: true,
      placeHolder: 'Stored securely in VS Code',
    });
    if (token === undefined) {
      return;
    }
    await setToken(context, token.trim());
    gitlab = null;
    void vscode.window.showInformationMessage('GitLab token saved.');
    void refresh();
  }

  async function workspaceProjectPath(): Promise<string | null> {
    const root = findGitRoot();
    if (!root) {
      return null;
    }
    try {
      const origin = await getOriginUrl(root);
      return projectPathFromRemote(origin);
    } catch {
      return null;
    }
  }

  async function currentProjectPath(): Promise<string | null> {
    const selected = getSelectedProject();
    if (selected) {
      return selected.path;
    }
    return workspaceProjectPath();
  }

  async function searchAndPickProject(
    client: GitLabClient
  ): Promise<{ path: string; name: string } | undefined> {
    const term = await vscode.window.showInputBox({
      title: 'GitLab MR — Select Project',
      prompt: 'Search your accessible GitLab projects (leave empty to list recent ones)',
    });
    if (term === undefined) {
      return undefined;
    }
    return vscode.window.withProgress(
      { location: { viewId: 'gitlabMr.mrView' }, title: 'Searching projects…' },
      async () => {
        const projects = await client.searchProjects(term.trim());
        if (projects.length === 0) {
          void vscode.window.showWarningMessage(
            'No GitLab projects found for that search.'
          );
          return undefined;
        }
        const pick = await vscode.window.showQuickPick(
          projects.map((p) => ({
            label: p.path_with_namespace,
            description: p.name || '',
            p,
          })),
          { placeHolder: 'Select a GitLab project to monitor' }
        );
        if (!pick) {
          return undefined;
        }
        return { path: pick.p.path_with_namespace, name: pick.p.name };
      }
    );
  }


  async function refresh(full = true): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }
    const projectPath = await currentProjectPath();
    if (!projectPath) {
      provider.setMessage(
        'Select a project (GitLab MR: Select Project) or open a Git repository with a GitLab remote to monitor its MRs.'
      );
      return;
    }

    const monitor = new MrMonitor(context, client);
    await vscode.window.withProgress(
      { location: { viewId: 'gitlabMr.mrView' } },
      async () => {
        try {
          const { mrs, projectPath: resolvedPath, events } = await monitor.run(
            projectPath,
            { full }
          );
          provider.setData(mrs, resolvedPath);
          if (full) {
            await updateEditorComments(mrs);
          }
          for (const ev of events) {
            notify(ev);
          }
        } catch (err) {
          provider.setMessage(`GitLab MR refresh failed: ${(err as Error).message}`);
          void vscode.window.showErrorMessage(
            `GitLab MR refresh failed: ${(err as Error).message}`
          );
        }
      }
    );
  }

  async function updateEditorComments(mrs: EnrichedMR[]): Promise<void> {
    if (!commentProvider) {
      return;
    }
    if (!getShowCommentsInEditor()) {
      commentProvider.clear();
      return;
    }
    try {
      const root = findGitRoot();
      if (!root) {
        commentProvider.clear();
        return;
      }
      const branch = await getBranch(root);
      const mr = mrs.find((m) => m.source_branch === branch);
      if (mr) {
        await commentProvider.showForMr(mr, root);
      } else {
        commentProvider.clear();
      }
    } catch {
      commentProvider.clear();
    }
  }

  async function editSelectedMr(mr: EnrichedMR): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }
    await editMrFlow(client, mr, () => void refresh());
  }

  async function retryMrPipeline(mr: EnrichedMR, pipelineId: number): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }
    try {
      await vscode.window.withProgress(
        { location: { viewId: 'gitlabMr.mrView' }, title: 'Retrying pipeline…' },
        () => client.retryPipeline(mr.project_id, pipelineId)
      );
      void vscode.window.showInformationMessage(`Pipeline #${pipelineId} of MR !${mr.iid} retried.`);
      void refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to retry pipeline: ${(err as Error).message}`
      );
    }
  }

  async function playMrJob(mr: EnrichedMR, jobId: number): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }
    try {
      await vscode.window.withProgress(
        { location: { viewId: 'gitlabMr.mrView' }, title: 'Playing manual job…' },
        () => client.playJob(mr.project_id, jobId)
      );
      void vscode.window.showInformationMessage(`Manual job #${jobId} started.`);
      void refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to start job: ${(err as Error).message}`
      );
    }
  }

  async function retryMrJob(mr: EnrichedMR, jobId: number): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }
    try {
      await vscode.window.withProgress(
        { location: { viewId: 'gitlabMr.mrView' }, title: 'Retrying job…' },
        () => client.retryJob(mr.project_id, jobId)
      );
      void vscode.window.showInformationMessage(`Job #${jobId} retried.`);
      void refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to retry job: ${(err as Error).message}`
      );
    }
  }

  async function runNewMrPipeline(mr: EnrichedMR): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `Start a new pipeline for MR !${mr.iid} on branch ${mr.source_branch}?`,
      { modal: true },
      'Start'
    );
    if (answer !== 'Start') {
      return;
    }
    const ref = mr.source_branch;
    try {
      await vscode.window.withProgress(
        { location: { viewId: 'gitlabMr.mrView' }, title: 'Starting pipeline…' },
        () => client.createMrPipeline(mr.project_id, mr.iid)
      );
      void vscode.window.showInformationMessage(
        `Pipeline started for MR !${mr.iid} on ${ref}.`
      );
      void refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to start pipeline: ${(err as Error).message}`
      );
    }
  }

  async function startMrPipeline(mr: EnrichedMR, jobIds: number[]): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }
    try {
      await vscode.window.withProgress(
        {
          location: { viewId: 'gitlabMr.mrView' },
          title: `Starting pipeline: playing ${jobIds.length} job(s)…`,
        },
        async () => {
          for (const jobId of jobIds) {
            await client.playJob(mr.project_id, jobId);
          }
        }
      );
      void vscode.window.showInformationMessage(
        `Started ${jobIds.length} job(s) for MR !${mr.iid}.`
      );
      void refresh();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to start pipeline: ${(err as Error).message}`
      );
    }
  }

  function notify(ev: MonitorEvent): void {
    const message = `MR !${ev.iid} — ${ev.title}\n${ev.changes.join('\n')}`;
    const show = ev.critical
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;
    void show(message, 'Open MR').then((choice) => {
      if (choice === 'Open MR') {
        void vscode.env.openExternal(vscode.Uri.parse(ev.webUrl));
      }
    });
    if (ev.critical && getNotifyDesktop()) {
      desktopPopup(ev);
    }
  }

  function desktopPopup(ev: MonitorEvent): void {
    const summary = `MR !${ev.iid}`;
    const body = ev.changes.join('\n').slice(0, 200);
    execFile('notify-send', ['-u', 'critical', '-a', 'GitLab MR Monitor', summary, body], () => {
      // Ignore failures – the VS Code toast was already shown.
    });
  }

  async function selectProject(): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }
    const picked = await searchAndPickProject(client);
    if (!picked) {
      return;
    }
    await context.globalState.update(SELECTED_PROJECT_KEY, picked);
    void vscode.window.showInformationMessage(`Monitoring ${picked.path}.`);
    void refresh();
  }

  async function cloneProject(): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }

    const current = getSelectedProject();
    const workspace = await workspaceProjectPath();
    const options: vscode.QuickPickItem[] = [];
    if (current) {
      options.push({
        label: current.path,
        description: current.name || 'Selected project',
      });
    }
    if (workspace && workspace !== current?.path) {
      options.push({
        label: workspace,
        description: 'Current git repository',
      });
    }
    options.push({ label: '$(search) Search for a project…' });

    const choice = await vscode.window.showQuickPick(options, {
      placeHolder: 'Choose a project to clone',
    });
    if (!choice) {
      return;
    }

    let projectPath: string;
    if (choice.label === '$(search) Search for a project…') {
      const picked = await searchAndPickProject(client);
      if (!picked) {
        return;
      }
      projectPath = picked.path;
    } else {
      projectPath = choice.label;
    }

    let project;
    try {
      project = await client.getProject(projectPath);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Could not load project ${projectPath}: ${(err as Error).message}`
      );
      return;
    }
    const method = await vscode.window.showQuickPick(
      [
        { label: 'SSH', description: project.ssh_url_to_repo },
        { label: 'HTTPS', description: project.http_url_to_repo },
      ],
      { placeHolder: `Choose clone method for ${project.path_with_namespace}` }
    );
    if (!method) {
      return;
    }
    const url =
      method.label === 'SSH'
        ? project.ssh_url_to_repo
        : project.http_url_to_repo;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    let target: vscode.Uri;
    let alreadyOpen = false;
    if (workspaceFolder) {
      target = workspaceFolder.uri;
      alreadyOpen = true;
    } else {
      const dest = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select clone destination',
        title: `Choose where to clone ${project.path_with_namespace}`,
      });
      if (!dest || dest.length === 0) {
        return;
      }
      target = dest[0];
    }

    try {
      await vscode.window.withProgress(
        {
          location: { viewId: 'gitlabMr.mrView' },
          title: `Cloning ${project.path_with_namespace}…`,
        },
        () => execFileP('git', ['clone', url, target.fsPath])
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Clone failed: ${(err as Error).message}`
      );
      return;
    }
    await context.globalState.update(SELECTED_PROJECT_KEY, {
      path: project.path_with_namespace,
      name: project.name,
    });
    void refresh();
    if (alreadyOpen) {
      void vscode.window.showInformationMessage(
        `Cloned ${project.path_with_namespace} into ${target.fsPath}.`
      );
      return;
    }
    const answer = await vscode.window.showInformationMessage(
      `Cloned ${project.path_with_namespace} into ${target.fsPath}.`,
      'Open Folder'
    );
    if (answer === 'Open Folder') {
      await vscode.commands.executeCommand('vscode.openFolder', target);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('gitlabMr.refresh', () => void refresh()),

    vscode.commands.registerCommand('gitlabMr.selectProject', () =>
      void selectProject()
    ),

    vscode.commands.registerCommand('gitlabMr.cloneProject', () =>
      void cloneProject()
    ),

    vscode.commands.registerCommand('gitlabMr.createMr', async () => {
      const client = await ensureClient();
      if (!client) {
        return;
      }
      await createMrFlow(client, () => void refresh());
    }),

    vscode.commands.registerCommand('gitlabMr.setToken', () => setTokenCommand()),

    vscode.commands.registerCommand(
      'gitlabMr.replyToComment',
      async (thread: vscode.CommentThread) => {
        if (!commentProvider) {
          return;
        }
        const info = commentProvider.getThreadInfo(thread);
        if (!info) {
          return;
        }
        const body = await vscode.window.showInputBox({
          title: `Reply to discussion on !${info.iid}`,
          prompt: 'Type your reply',
          placeHolder: 'Write a comment…',
        });
        if (!body || !body.trim()) {
          return;
        }
        const client = await ensureClient();
        if (!client) {
          return;
        }
        try {
          await client.postDiscussionNote(info.projectId, info.iid, info.discussionId, body.trim());
          void vscode.window.showInformationMessage('Reply posted.');
          void refresh();
        } catch (err) {
          void vscode.window.showErrorMessage(
            `Failed to post reply: ${(err as Error).message}`
          );
        }
      }
    ),
  );

  const minutes = getRefreshMinutes();
  const timer = setInterval(() => void refresh(), minutes * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  context.subscriptions.push({
    dispose: () => {
      commentProvider?.dispose();
      commentProvider = null;
    },
  });

  void refresh();
}

export function deactivate(): void {
  // nothing to clean up – timers/subscriptions are disposed via context
}
