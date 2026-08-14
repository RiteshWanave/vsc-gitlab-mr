import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function findGitRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    return undefined;
  }
  for (const f of folders) {
    if (fs.existsSync(path.join(f.uri.fsPath, '.git'))) {
      return f.uri.fsPath;
    }
  }
  return folders[0].uri.fsPath;
}
