import * as vscode from 'vscode';
import { GitLabClient, ProjectInfo } from './gitlab';
import { EnrichedMR } from './monitor';
import {
  getBranch,
  getOriginUrl,
  projectPathFromRemote,
  listTemplates,
  readTemplate,
  branchToTitle,
  readConventionalCommits,
  ConventionalConfig,
} from './repo';
import { findGitRoot } from './workspace';
import { parseTemplate, ParsedTemplate, buildDescription } from './template';

interface CreateOptions {
  gitlab: GitLabClient;
  project: ProjectInfo;
  projectPath: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  parsed: ParsedTemplate;
  conventional: ConventionalConfig | null;
  onCreated: () => void;
}

export async function createMrFlow(
  gitlab: GitLabClient,
  onCreated: () => void
): Promise<void> {
  const root = findGitRoot();
  if (!root) {
    void vscode.window.showErrorMessage('Open a Git repository to create a merge request.');
    return;
  }

  let sourceBranch: string;
  try {
    sourceBranch = await getBranch(root);
  } catch (err) {
    void vscode.window.showErrorMessage(`Cannot read current branch: ${(err as Error).message}`);
    return;
  }
  if (sourceBranch === 'HEAD') {
    void vscode.window.showErrorMessage('You are in a detached HEAD state – checkout a branch first.');
    return;
  }

  let origin: string;
  try {
    origin = await getOriginUrl(root);
  } catch {
    void vscode.window.showErrorMessage(`No git remote "origin" found in this repository.`);
    return;
  }
  const projectPath = projectPathFromRemote(origin);
  if (!projectPath) {
    void vscode.window.showErrorMessage(`Cannot detect the GitLab project from origin: ${origin}`);
    return;
  }

  let project: ProjectInfo;
  try {
    project = await gitlab.getProject(projectPath);
  } catch (err) {
    void vscode.window.showErrorMessage(`Cannot read project ${projectPath}: ${(err as Error).message}`);
    return;
  }

  let templateContent = '';
  const templates = listTemplates(root);
  if (templates.length > 0) {
    const pick = await vscode.window.showQuickPick(templates, {
      placeHolder: `Choose a template from ${root}/.gitlab/merge_request_templates`,
    });
    if (!pick) {
      return;
    }
    templateContent = readTemplate(root, pick);
  } else {
    const ok = await vscode.window.showInformationMessage(
      'No .gitlab/merge_request_templates found in this repository – start with an empty form?',
      { modal: true },
      'Start empty'
    );
    if (!ok) {
      return;
    }
  }
  const parsed = parseTemplate(templateContent);
  const conventional = readConventionalCommits(root);

  const defaultTitle = branchToTitle(sourceBranch);
  let title = defaultTitle;
  if (!conventional) {
    const picked = await vscode.window.showInputBox({
      title: 'Merge request title',
      value: defaultTitle,
      validateInput: (v) => (v && v.trim().length ? undefined : 'Title is required'),
    });
    if (picked === undefined) {
      return;
    }
    title = picked;
  }

  const defaultTarget = project.default_branch || 'master';
  const pickTarget = await vscode.window.showQuickPick(
    [
      { label: `$(git-branch) ${defaultTarget}`, description: 'default branch', value: defaultTarget },
      { label: '$(edit) Type custom target branch…', value: undefined as string | undefined },
    ],
    { placeHolder: `Target branch for ${sourceBranch}` }
  );
  if (!pickTarget) {
    return;
  }
  let targetBranch = pickTarget.value || defaultTarget;
  if (!pickTarget.value) {
    const custom = await vscode.window.showInputBox({ title: 'Target branch', value: defaultTarget });
    if (custom === undefined) {
      return;
    }
    targetBranch = custom;
  }

  openCreatePanel({
    gitlab,
    project,
    projectPath,
    sourceBranch,
    targetBranch,
    title,
    parsed,
    conventional,
    onCreated,
  });
}

function openCreatePanel(opts: CreateOptions): void {
  const panel = vscode.window.createWebviewPanel(
    'gitlabMr.createMr',
    'New Merge Request',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  panel.webview.html = getWebviewHtml(opts);

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command === 'cancel') {
      panel.dispose();
      return;
    }
    if (msg.command !== 'create') {
      return;
    }
    const description = buildDescription(opts.parsed, msg);
    try {
      const created = await opts.gitlab.createMR(opts.project.id, {
        source_branch: opts.sourceBranch,
        target_branch: opts.targetBranch,
        title: msg.title,
        description,
      });
      panel.dispose();
      void vscode.window.showInformationMessage(
        `MR !${created.iid} created: ${opts.sourceBranch} → ${opts.targetBranch}`
      );
      void vscode.env.openExternal(vscode.Uri.parse(created.web_url));
      opts.onCreated();
    } catch (err) {
      void vscode.window.showErrorMessage(`Failed to create MR: ${(err as Error).message}`);
    }
  });
}

export async function editMrFlow(
  gitlab: GitLabClient,
  mr: EnrichedMR,
  onUpdated: () => void
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'gitlabMr.editMr',
    `Edit MR !${mr.iid}`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const data = {
    iid: mr.iid,
    title: esc(mr.title),
    description: esc(mr.detail.description || ''),
    webUrl: esc(mr.web_url),
  };
  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 20px; }
    .field { margin-bottom: 14px; }
    label { display: block; font-weight: 600; margin-bottom: 4px; }
    input, textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background);
      color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent);
      padding: 6px 8px; border-radius: 4px; font-family: inherit; font-size: 13px; }
    textarea { min-height: 320px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
    .actions { display: flex; gap: 10px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .link { font-size: 12px; margin-bottom: 14px; }
  </style>
</head>
<body>
  <div class="link"><a href="#" id="open">Open MR !${data.iid} in browser</a></div>
  <div class="field">
    <label for="title">Title</label>
    <input id="title" value="${data.title}">
  </div>
  <div class="field">
    <label for="desc">Description (Markdown)</label>
    <textarea id="desc">${data.description}</textarea>
  </div>
  <div class="actions">
    <button id="save">Save</button>
    <button id="cancel" class="secondary">Cancel</button>
  </div>
  <script>
    (function () {
      var vscode = acquireVsCodeApi();
      var data = ${JSON.stringify({ iid: mr.iid, webUrl: mr.web_url })};
      document.getElementById('open').addEventListener('click', function (e) {
        e.preventDefault();
        vscode.postMessage({ type: 'open', webUrl: data.webUrl });
      });
      document.getElementById('cancel').addEventListener('click', function () {
        vscode.postMessage({ type: 'cancel' });
      });
      document.getElementById('save').addEventListener('click', function () {
        vscode.postMessage({
          type: 'save',
          title: document.getElementById('title').value,
          description: document.getElementById('desc').value
        });
      });
    })();
  </script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'cancel') {
      panel.dispose();
      return;
    }
    if (msg.type === 'open') {
      await vscode.env.openExternal(vscode.Uri.parse(msg.webUrl));
      return;
    }
    if (msg.type === 'save') {
      const title = (msg.title as string).trim();
      if (!title) {
        void vscode.window.showErrorMessage('Title is required.');
        return;
      }
      try {
        await gitlab.updateMR(mr.project_id, mr.iid, {
          title,
          description: msg.description as string,
        });
        panel.dispose();
        void vscode.window.showInformationMessage(`MR !${mr.iid} updated.`);
        onUpdated();
      } catch (err) {
        void vscode.window.showErrorMessage(`Failed to update MR: ${(err as Error).message}`);
      }
    }
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getWebviewHtml(opts: CreateOptions): string {
  const { projectPath, sourceBranch, targetBranch, title, parsed, conventional } = opts;
  const data = {
    projectPath: esc(projectPath),
    sourceBranch: esc(sourceBranch),
    targetBranch: esc(targetBranch),
    title: esc(title),
    commitTypes: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    conventional: conventional
      ? { requireScopes: conventional.requireScopes, scopes: conventional.scopes }
      : null,
    variables: parsed.variables.map((v) => esc(v)),
    quickActions: esc(parsed.quickActions.join('\n')),
    fields: parsed.fields.map((f) => ({
      label: esc(f.label),
      content: esc(f.content),
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 20px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 18px; }
    .field { margin-bottom: 14px; }
    label { display: block; font-weight: 600; margin-bottom: 4px; }
    input, textarea, select {
      width: 100%; box-sizing: border-box;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 6px 8px; border-radius: 4px;
      font-family: inherit; font-size: 13px;
    }
    input:focus, textarea:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
    textarea { min-height: 70px; resize: vertical; }
    textarea.big { min-height: 120px; }
    .cc-row { display: flex; gap: 10px; }
    .cc-row select { flex: 1; }
    .preview {
      margin-top: 6px; padding: 6px 8px; border-radius: 4px;
      background: var(--vscode-editor-inlineValueBackground, var(--vscode-textBlockQuote-background));
      color: var(--vscode-descriptionForeground); font-size: 12px; font-family: var(--vscode-editor-font-family, monospace);
      min-height: 16px;
    }
    .actions { margin-top: 18px; display: flex; gap: 10px; }
    button {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px;
    }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .error { color: var(--vscode-errorForeground); font-size: 12px; margin-top: 8px; display: none; }
  </style>
</head>
<body>
  <h1>New Merge Request</h1>
  <div class="meta">${data.projectPath} &nbsp;·&nbsp; ${data.sourceBranch} → ${data.targetBranch}</div>

  <div class="field" id="ccField" style="display:none">
    <label>Title (Conventional Commit)</label>
    <div class="cc-row">
      <select id="ccType"></select>
      <select id="ccScope"></select>
    </div>
    <input id="ccSubject" placeholder="Description, e.g. action was not populating" style="margin-top:8px">
    <div class="preview" id="ccPreview"></div>
  </div>
  <div class="field" id="titleField">
    <label for="title">Title</label>
    <input id="title" value="${data.title}">
  </div>
  <div id="variables"></div>
  <div id="fields"></div>
  <div class="field" id="qaField" style="display:none">
    <label for="qa">Quick actions (one per line, e.g. /assign me)</label>
    <textarea id="qa"></textarea>
  </div>

  <div class="actions">
    <button id="create">Create Merge Request</button>
    <button id="cancel" class="secondary">Cancel</button>
  </div>
  <div class="error" id="error"></div>

  <script>
    (function () {
      var data = ${JSON.stringify(data)};
      var vscode = acquireVsCodeApi();

      function showError(msg) {
        var e = document.getElementById('error');
        e.textContent = msg;
        e.style.display = 'block';
      }

      var fieldsContainer = document.getElementById('fields');
      data.fields.forEach(function (f, i) {
        var div = document.createElement('div');
        div.className = 'field';
        var label = document.createElement('label');
        label.textContent = f.label;
        label.htmlFor = 'f' + i;
        var ta = document.createElement('textarea');
        ta.id = 'f' + i;
        ta.value = f.content;
        if (f.label === 'Description' || f.label === 'Changes' || f.label === 'Testing') {
          ta.className = 'big';
        }
        div.appendChild(label);
        div.appendChild(ta);
        fieldsContainer.appendChild(div);
      });

      var variablesContainer = document.getElementById('variables');
      if (data.variables.length) {
        data.variables.forEach(function (v, i) {
          var div = document.createElement('div');
          div.className = 'field';
          var label = document.createElement('label');
          label.textContent = v;
          label.htmlFor = 'v' + i;
          var input = document.createElement('input');
          input.id = 'v' + i;
          input.placeholder = 'Replace "PUT ' + v + ' HERE"';
          div.appendChild(label);
          div.appendChild(input);
          variablesContainer.appendChild(div);
        });
      }

      var ccField = document.getElementById('ccField');
      if (data.conventional) {
        ccField.style.display = '';
        document.getElementById('titleField').style.display = 'none';

        var typeSel = document.getElementById('ccType');
        data.commitTypes.forEach(function (t) {
          var opt = document.createElement('option');
          opt.value = t;
          opt.textContent = t;
          typeSel.appendChild(opt);
        });
        typeSel.value = 'fix';

        var scopeSel = document.getElementById('ccScope');
        if (!data.conventional.requireScopes) {
          var none = document.createElement('option');
          none.value = '';
          none.textContent = '(no scope)';
          scopeSel.appendChild(none);
        }
        if (data.conventional.scopes.length) {
          data.conventional.scopes.forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            scopeSel.appendChild(opt);
          });
        } else {
          var ph = document.createElement('option');
          ph.value = '';
          ph.textContent = data.conventional.requireScopes ? 'Select scope…' : 'Scope…';
          ph.disabled = true;
          ph.selected = true;
          scopeSel.insertBefore(ph, scopeSel.firstChild);
        }

        var subjectInput = document.getElementById('ccSubject');
        subjectInput.value = ${JSON.stringify(title)};

        function updatePreview() {
          var t = typeSel.value;
          var s = scopeSel.value;
          var sub = subjectInput.value.trim();
          document.getElementById('ccPreview').textContent =
            t + (s ? '(' + s + ')' : '') + (sub ? ': ' + sub : '');
        }
        typeSel.addEventListener('change', updatePreview);
        scopeSel.addEventListener('change', updatePreview);
        subjectInput.addEventListener('input', updatePreview);
        updatePreview();
      } else {
        document.getElementById('ccField').style.display = 'none';
      }

      if (data.quickActions) {
        var qf = document.getElementById('qaField');
        qf.style.display = '';
        document.getElementById('qa').value = data.quickActions;
      }

      document.getElementById('cancel').addEventListener('click', function () {
        vscode.postMessage({ command: 'cancel' });
      });

      document.getElementById('create').addEventListener('click', function () {
        var title;
        if (data.conventional) {
          var type = document.getElementById('ccType').value;
          var scope = document.getElementById('ccScope').value;
          var subject = document.getElementById('ccSubject').value.trim();
          if (!type) { showError('Commit type is required.'); return; }
          if (data.conventional.requireScopes && !scope) { showError('Scope is required.'); return; }
          title = type + (scope ? '(' + scope + ')' : '') + (subject ? ': ' + subject : '');
        } else {
          title = document.getElementById('title').value.trim();
          if (!title) { showError('Title is required.'); return; }
        }
        var variables = data.variables.map(function (_, i) {
          return document.getElementById('v' + i).value;
        });
        var fields = data.fields.map(function (_, i) {
          return document.getElementById('f' + i).value;
        });
        vscode.postMessage({
          command: 'create',
          title: title,
          variables: variables,
          fields: fields,
          quickActions: document.getElementById('qa').value
        });
      });
    })();
  </script>
</body>
</html>`;
}
