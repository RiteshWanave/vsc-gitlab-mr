import * as vscode from 'vscode';

const DEFAULT_BASE_URL = 'https://gitlab.com';

export function getBaseUrl(): string {
  const url = vscode.workspace
    .getConfiguration('gitlabMr')
    .get<string>('baseUrl', DEFAULT_BASE_URL);
  return url.replace(/\/+$/, '');
}

export function isBaseUrlConfigured(): boolean {
  const info = vscode.workspace.getConfiguration('gitlabMr').inspect<string>('baseUrl');
  return !!(info && (info.globalValue || info.workspaceValue));
}

export async function setBaseUrl(url: string): Promise<void> {
  await vscode.workspace
    .getConfiguration('gitlabMr')
    .update('baseUrl', url.replace(/\/+$/, ''), vscode.ConfigurationTarget.Global);
}

export function getRefreshMinutes(): number {
  const m = vscode.workspace
    .getConfiguration('gitlabMr')
    .get<number>('refreshIntervalMinutes', 5);
  return m > 0 ? m : 5;
}

export function getNotifyDesktop(): boolean {
  return vscode.workspace
    .getConfiguration('gitlabMr')
    .get<boolean>('notifyDesktop', true);
}

export function getShowCommentsInEditor(): boolean {
  return vscode.workspace
    .getConfiguration('gitlabMr')
    .get<boolean>('showCommentsInEditor', true);
}

export async function getToken(context: vscode.ExtensionContext): Promise<string> {
  return (await context.secrets.get('gitlabMr.token')) ?? '';
}

export async function setToken(context: vscode.ExtensionContext, token: string): Promise<void> {
  await context.secrets.store('gitlabMr.token', token);
}
