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

  async function currentProjectPath(): Promise<string | null> {
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

  async function refresh(full = true): Promise<void> {
    const client = await ensureClient();
    if (!client) {
      return;
    }
    const projectPath = await currentProjectPath();
    if (!projectPath) {
      provider.setMessage('Open a Git repository with a GitLab remote to monitor its MRs.');
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

  context.subscriptions.push(
    vscode.commands.registerCommand('gitlabMr.refresh', () => void refresh()),

    vscode.commands.registerCommand('gitlabMr.createMr', async () => {
      const client = await ensureClient();
      if (!client) {
        return;
      }
      await createMrFlow(client, () => void refresh());
    }),

    vscode.commands.registerCommand('gitlabMr.setToken', () => setTokenCommand())
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
