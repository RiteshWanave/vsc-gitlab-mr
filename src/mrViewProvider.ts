import * as vscode from 'vscode';
import { EnrichedMR } from './monitor';

export interface MrViewProviderCallbacks {
  onRefresh: () => void;
  onRefreshLight: () => void;
  onEdit: (mr: EnrichedMR) => void;
  onRetryPipeline: (mr: EnrichedMR, pipelineId: number) => void;
  onPlayJob: (mr: EnrichedMR, jobId: number) => void;
  onRetryJob: (mr: EnrichedMR, jobId: number) => void;
  onCreatePipeline: (mr: EnrichedMR) => void;
  onStartPipeline: (mr: EnrichedMR, jobIds: number[]) => void;
}

export class MrViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private mrs: EnrichedMR[] = [];
  private message: string | null = null;
  private projectName = '';

  constructor(private callbacks: MrViewProviderCallbacks) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewHtml();

    webviewView.webview.onDidReceiveMessage((msg) => {
      void this.onMessage(msg);
    });

    this.push();
  }

  setData(mrs: EnrichedMR[], projectName: string): void {
    this.mrs = [...mrs].sort((a, b) => b.iid - a.iid);
    this.projectName = projectName;
    this.message = null;
    this.push();
  }

  setMessage(message: string): void {
    this.message = message;
    this.mrs = [];
    this.projectName = '';
    this.push();
  }

  getMr(iid: number): EnrichedMR | undefined {
    return this.mrs.find((m) => m.iid === iid);
  }

  private async onMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'open': {
        const mr = this.getMr(Number(msg.iid));
        if (mr) {
          await vscode.env.openExternal(vscode.Uri.parse(mr.web_url));
        }
        break;
      }
      case 'copy': {
        const mr = this.getMr(Number(msg.iid));
        if (mr) {
          await vscode.env.clipboard.writeText(mr.web_url);
          void vscode.window.showInformationMessage(`Copied MR !${mr.iid} link to clipboard.`);
        }
        break;
      }
      case 'copyAll': {
        if (this.mrs.length === 0) {
          break;
        }
        const all = this.mrs.map((m) => m.web_url).join('\n');
        await vscode.env.clipboard.writeText(all);
        void vscode.window.showInformationMessage(`Copied ${this.mrs.length} MR links to clipboard.`);
        break;
      }
      case 'edit': {
        const mr = this.getMr(Number(msg.iid));
        if (mr) {
          this.callbacks.onEdit(mr);
        }
        break;
      }
      case 'retryPipeline': {
        const mr = this.getMr(Number(msg.iid));
        const pipelineId = Number(msg.pipelineId);
        if (mr && pipelineId) {
          this.callbacks.onRetryPipeline(mr, pipelineId);
        }
        break;
      }
      case 'playJob': {
        const mr = this.getMr(Number(msg.iid));
        const jobId = Number(msg.jobId);
        if (mr && jobId) {
          this.callbacks.onPlayJob(mr, jobId);
        }
        break;
      }
      case 'retryJob': {
        const mr = this.getMr(Number(msg.iid));
        const jobId = Number(msg.jobId);
        if (mr && jobId) {
          this.callbacks.onRetryJob(mr, jobId);
        }
        break;
      }
      case 'createPipeline': {
        const mr = this.getMr(Number(msg.iid));
        if (mr) {
          this.callbacks.onCreatePipeline(mr);
        }
        break;
      }
      case 'startPipeline': {
        const mr = this.getMr(Number(msg.iid));
        const jobIds = Array.isArray(msg.jobIds)
          ? (msg.jobIds as number[]).map(Number).filter((x) => x > 0)
          : [];
        if (mr && jobIds.length > 0) {
          this.callbacks.onStartPipeline(mr, jobIds);
        }
        break;
      }
      case 'refresh':
        this.callbacks.onRefresh();
        break;
      case 'refreshLight':
        this.callbacks.onRefreshLight();
        break;
    }
  }

  private push(): void {
    if (!this.view) {
      return;
    }
    const cards = this.mrs.map((m) => {
      const discussions = (m.discussions || []).filter((d) =>
        (d.notes || []).some((n) => n.position)
      ).map((d) => ({
        id: d.id,
        resolved: !!d.resolved,
        resolvable: !!d.resolvable,
        notes: (d.notes || []).map((n) => ({
          id: n.id,
          body: n.body,
          author: n.author?.name || n.author?.username || 'unknown',
          username: n.author?.username || '',
          system: !!n.system,
          resolved: !!n.resolved,
        })),
      }));
      let unresolvedComments = 0;
      for (const d of discussions) {
        if (d.resolvable && !d.resolved) { unresolvedComments++; }
      }
      return {
      iid: m.iid,
      title: m.title,
      webUrl: m.web_url,
      branch: m.source_branch,
      targetBranch: m.target_branch,
      hasConflicts: m.detail.has_conflicts,
      mergeStatus: m.detail.merge_status,
      approvalsApproved: m.approvalsApproved,
      approvalsRequired: m.approvalsRequired,
      unresolvedComments,
      discussions,
      pipeline: {
        id: m.pipeline.id,
        status: m.pipeline.status,
        stage: m.pipeline.stage,
        failedStage: m.pipeline.failedStage,
        stages: m.pipeline.stages.slice(0, 100),
      },
    }; });
    void this.view.webview.postMessage({
      type: 'data',
      projectName: this.projectName,
      message: this.message,
      cards,
    });
  }
}

function getWebviewHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
           padding: 0 8px 12px; font-size: 12.5px; }
    .toolbar { display: flex; gap: 8px; align-items: center; padding: 6px 0; position: sticky; top: 0;
               background: var(--vscode-sideBar-background); z-index: 5; }
    .toolbar .project { font-weight: 600; font-size: 11.5px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
             border: none; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    #copyAll { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    #copyAll:hover { background: var(--vscode-button-hoverBackground); }
    .status { color: var(--vscode-descriptionForeground); padding: 6px 2px; }
    .empty { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: 15px;
             text-align: center; padding: 40px 8px; }
    .card { border: 1px solid var(--vscode-panel-border); border-left: 3px solid var(--vscode-descriptionForeground);
            border-radius: 5px; background: var(--vscode-sideBar-background);
            padding: 7px 9px 7px 8px; margin-bottom: 6px; }
    .card:hover { border-color: var(--vscode-focusBorder); }
    .acc-success { border-left-color: var(--vscode-testing-iconPassed, #23a064); }
    .acc-failed { border-left-color: var(--vscode-testing-iconFailed, #e51400); }
    .acc-running, .acc-pending { border-left-color: var(--vscode-testing-iconQueued, #007acc); }
    .acc-manual { border-left-color: #d3843b; }
    .head { display: flex; align-items: flex-start; gap: 8px; }
    .title { font-weight: 600; cursor: pointer; flex: 1; line-height: 1.3; font-size: 12.5px; }
    .title:hover { color: var(--vscode-textLink-foreground); text-decoration: underline; }
    .headlinks { display: flex; gap: 9px; white-space: nowrap; font-size: 15px; color: var(--vscode-descriptionForeground); }
    .headlink { cursor: pointer; }
    .headlink:hover { color: var(--vscode-textLink-foreground); }
    .meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin: 2px 0 5px; }
    .badges { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; }
    .badge { font-size: 10px; padding: 1px 7px; border-radius: 9px; white-space: nowrap; }
    .b-success { background: var(--vscode-testing-iconPassed, #23a064); color: #fff; }
    .b-failed { background: var(--vscode-testing-iconFailed, #e51400); color: #fff; }
    .b-running, .b-pending { background: var(--vscode-testing-iconQueued, #007acc); color: #fff; }
    .b-manual { background: #d3843b; color: #fff; }
    .b-default { background: var(--vscode-input-background); color: var(--vscode-foreground); }
    .b-approve { background: #d3843b; color: #fff; }
    .b-conflict { background: #b52a2a; color: #fff; font-weight: 600; }
    .pipe { cursor: pointer; }
    .pipe:hover { text-decoration: underline; }
    .stages { margin: 4px 0 6px; border-top: 1px solid var(--vscode-panel-border); padding-top: 5px; }
    .stage-block { margin-bottom: 6px; }
    .stage-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 600; }
    .st-badge { font-size: 10px; padding: 1px 7px; border-radius: 9px; white-space: nowrap; font-weight: 400; }
    .st-failed { background: var(--vscode-testing-iconFailed, #e51400); color: #fff; }
    .st-running, .st-pending { background: var(--vscode-testing-iconQueued, #007acc); color: #fff; }
    .st-success { background: var(--vscode-testing-iconPassed, #23a064); color: #fff; }
    .st-manual { background: #d3843b; color: #fff; }
    .st-default { background: var(--vscode-input-background); color: var(--vscode-foreground); }
    .job-row { display: flex; align-items: center; gap: 6px; font-size: 11px; padding: 1px 0 1px 10px; }
    .job-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
    .job-name .wait { color: var(--vscode-foreground); font-weight: 600; }
    .job-act { cursor: pointer; color: var(--vscode-textLink-foreground); white-space: nowrap; font-size: 10.5px; }
    .job-act:hover { text-decoration: underline; }
    .pipe-actions { display: flex; gap: 6px; margin-top: 6px; }
    #runBtn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    #runBtn:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="project" id="project"></span>
    <button id="copyAll">Copy all MRs</button>
    <button id="refreshLight">Refresh MRs</button>
  </div>
  <div class="status" id="status"></div>
  <div id="list"></div>
  <script>
    (function () {
      var vscode = acquireVsCodeApi();
      var list = document.getElementById('list');
      var statusEl = document.getElementById('status');
      var projectEl = document.getElementById('project');
      var expandedPipe = {};

      function badge(text, cls, title) {
        var s = document.createElement('span');
        s.className = 'badge ' + cls;
        s.textContent = text;
        if (title) { s.title = title; }
        return s;
      }

      function stBadge(text, cls) {
        var s = document.createElement('span');
        s.className = 'st-badge ' + cls;
        s.textContent = text;
        return s;
      }

      function accent(status) {
        return status === 'success' ? 'acc-success'
          : status === 'failed' ? 'acc-failed'
          : (status === 'running' || status === 'pending') ? 'acc-running'
          : status === 'manual' ? 'acc-manual' : '';
      }

      function statusCls(status) {
        return status === 'failed' ? 'st-failed'
          : (status === 'running' || status === 'pending') ? 'st-running'
          : status === 'manual' ? 'st-manual'
          : status === 'success' ? 'st-success' : 'st-default';
      }

      function render(cards, message, projectName) {
        projectEl.textContent = projectName || '';
        var hasCards = !message && cards.length > 0;
        document.getElementById('copyAll').style.display = hasCards ? '' : 'none';
        document.getElementById('refreshLight').style.display = hasCards ? '' : 'none';
        if (message) {
          statusEl.className = 'status';
          statusEl.style.display = '';
          statusEl.textContent = message;
          list.innerHTML = '';
          return;
        }
        if (!cards.length) {
          statusEl.className = 'empty';
          statusEl.style.display = '';
          statusEl.textContent = 'No Open MR';
          list.innerHTML = '';
          return;
        }
        statusEl.style.display = 'none';
        list.innerHTML = '';
        cards.forEach(function (mr, i) {
          var card = document.createElement('div');
          card.className = 'card ' + accent(mr.pipeline.status);

          var head = document.createElement('div');
          head.className = 'head';
          var title = document.createElement('span');
          title.className = 'title';
          title.textContent = mr.title;
          title.title = 'Open in browser';
          title.dataset.i = String(i);
          var links = document.createElement('span');
          links.className = 'headlinks';
          var edit = document.createElement('span');
          edit.className = 'headlink';
          edit.textContent = '✎';
          edit.title = 'Edit description';
          edit.dataset.i = String(i);
          var copy = document.createElement('span');
          copy.className = 'headlink';
          copy.textContent = '⧉';
          copy.title = 'Copy MR link';
          copy.dataset.i = String(i);
          links.appendChild(edit);
          links.appendChild(copy);
          head.appendChild(title);
          head.appendChild(links);
          card.appendChild(head);

          var meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = '!' + mr.iid + ' · ' + mr.branch + ' → ' + mr.targetBranch;
          card.appendChild(meta);

          var badges = document.createElement('div');
          badges.className = 'badges';
          var pipeCls = mr.pipeline.status === 'success' ? 'b-success'
            : mr.pipeline.status === 'failed' ? 'b-failed'
            : (mr.pipeline.status === 'running' || mr.pipeline.status === 'pending') ? 'b-running'
            : mr.pipeline.status === 'manual' ? 'b-manual'
            : 'b-default';
          var pipe = badge('pipeline: ' + mr.pipeline.status + (expandedPipe[mr.iid] ? ' ▴' : ' ▾'), 'pipe ' + pipeCls, 'Show pipeline stages & jobs');
          pipe.dataset.i = String(i);
          badges.appendChild(pipe);
          if (mr.pipeline.stage) {
            badges.appendChild(badge('stage: ' + mr.pipeline.stage, 'b-default'));
          }
          if (mr.unresolvedComments > 0) {
            var cBadge = document.createElement('span');
            cBadge.className = 'badge b-default';
            cBadge.textContent = '💬 ' + mr.unresolvedComments;
            cBadge.title = mr.unresolvedComments + ' unresolved comment(s) needing resolution';
            badges.appendChild(cBadge);
          }
          if (mr.approvalsRequired > 0) {
            var done = Math.min(mr.approvalsApproved, mr.approvalsRequired);
            badges.appendChild(badge('✓ ' + done + '/' + mr.approvalsRequired, done >= mr.approvalsRequired ? 'b-success' : 'b-approve', 'Approvals'));
          } else if (mr.approvalsApproved > 0) {
            badges.appendChild(badge('✓ ' + mr.approvalsApproved, 'b-success', 'Approvals'));
          }
          if (mr.hasConflicts) {
            badges.appendChild(badge('⚠ conflicts', 'b-conflict', 'Merge conflict detected'));
          } else if (mr.mergeStatus === 'cannot_be_merged') {
            badges.appendChild(badge('⛔ cannot merge', 'b-conflict'));
          }
          card.appendChild(badges);

          if (expandedPipe[mr.iid]) {
            var panel = document.createElement('div');
            panel.className = 'stages';
            var hasJobs = false;
            var playableIds = [];
            var playableCount = 0;
            mr.pipeline.stages.forEach(function (s) {
              if (s.jobs) {
                s.jobs.forEach(function (j) {
                  if (j.playable) { playableIds.push(j.id); playableCount++; }
                });
              }
            });
            if (playableCount > 0) {
              var startRow = document.createElement('div');
              startRow.className = 'pipe-actions';
              startRow.style.borderBottom = '1px solid var(--vscode-panel-border)';
              startRow.style.paddingBottom = '6px';
              startRow.style.marginBottom = '6px';
              var startB = startPipelineBtn(mr.iid, playableIds, playableCount);
              startRow.appendChild(startB);
              panel.appendChild(startRow);
            }
            mr.pipeline.stages.forEach(function (s) {
              var block = document.createElement('div');
              block.className = 'stage-block';
              var sHead = document.createElement('div');
              sHead.className = 'stage-head';
              var sName = document.createElement('span');
              sName.textContent = s.name;
              sHead.appendChild(sName);
              block.appendChild(sHead);
              if (s.jobs && s.jobs.length) {
                hasJobs = true;
                s.jobs.forEach(function (j) {
                  var row = document.createElement('div');
                  row.className = 'job-row';
                  var jName = document.createElement('span');
                  jName.className = 'job-name';
                  if (j.status === 'running' || j.status === 'pending') {
                    var wait = document.createElement('span');
                    wait.className = 'wait';
                    wait.textContent = j.status + ': ';
                    jName.appendChild(wait);
                  }
                  jName.appendChild(document.createTextNode(j.name));
                  row.appendChild(jName);
                  row.appendChild(stBadge(j.status, statusCls(j.status)));
                  if (j.playable) {
                    row.appendChild(actionLink('▶ Play', 'playJob', mr.iid, j.id, 'Start this job'));
                  } else if (j.status === 'failed') {
                    row.appendChild(actionLink('↻ Retry', 'retryJob', mr.iid, j.id, 'Retry this job'));
                  }
                  block.appendChild(row);
                });
              }
              panel.appendChild(block);
            });
            if (!hasJobs) {
              var none = document.createElement('div');
              none.className = 'job-name';
              none.textContent = 'No jobs in pipeline.';
              panel.appendChild(none);
            }
            var actions = document.createElement('div');
            actions.className = 'pipe-actions';
            if (playableIds.length > 0) {
              actions.appendChild(startPipelineBtn(mr.iid, playableIds, playableIds.length));
            }
            if (mr.pipeline.status === 'failed' || mr.pipeline.status === 'canceled') {
              actions.appendChild(pipelineBtn('↻ Retry failed', 'retryPipeline', mr.iid, mr.pipeline.id, 'Retry failed/canceled jobs'));
            }
            if (mr.pipeline.id) {
              actions.appendChild(pipelineBtn('⟳ Run new pipeline', 'createPipeline', mr.iid, 0, 'Start a new pipeline on ' + mr.branch + ' (restart the whole pipeline)'));
            }
            panel.appendChild(actions);
            card.appendChild(panel);
          }

          list.appendChild(card);
        });
      }

      function actionLink(text, type, iid, id, title) {
        var a = document.createElement('span');
        a.className = 'job-act';
        a.textContent = text;
        a.title = title;
        a.dataset.type = type;
        a.dataset.iid = String(iid);
        a.dataset.id = String(id);
        return a;
      }

      function pipelineBtn(text, type, iid, pipelineId, title) {
        var b = document.createElement('button');
        b.id = 'runBtn';
        b.textContent = text;
        b.title = title;
        b.dataset.type = type;
        b.dataset.iid = String(iid);
        b.dataset.pid = String(pipelineId);
        return b;
      }

      function startPipelineBtn(iid, jobIds, count) {
        var b = document.createElement('button');
        b.id = 'runBtn';
        b.textContent = '▶ Start pipeline';
        b.title = 'Play ' + count + ' job(s) to start this pipeline';
        b.dataset.type = 'startPipeline';
        b.dataset.iid = String(iid);
        b.dataset.jobs = jobIds.join(',');
        return b;
      }

      document.getElementById('copyAll').addEventListener('click', function () {
        vscode.postMessage({ type: 'copyAll' });
      });

      document.getElementById('refreshLight').addEventListener('click', function () {
        vscode.postMessage({ type: 'refreshLight' });
      });

      list.addEventListener('click', function (e) {
        var t = e.target;
        if (t.classList && t.classList.contains('title')) {
          vscode.postMessage({ type: 'open', iid: Number(cards[Number(t.dataset.i)].iid) });
          return;
        }
        if (t.classList && t.classList.contains('pipe')) {
          var mr = cards[Number(t.dataset.i)];
          expandedPipe[mr.iid] = !expandedPipe[mr.iid];
          render(cards, null, projectEl.textContent);
          return;
        }
        if (t.classList && t.classList.contains('headlink')) {
          var m = cards[Number(t.dataset.i)];
          if (t.textContent.indexOf('⧉') !== -1) {
            vscode.postMessage({ type: 'copy', iid: Number(m.iid) });
          } else {
            vscode.postMessage({ type: 'edit', iid: Number(m.iid) });
          }
          return;
        }
        if (t.classList && t.classList.contains('job-act')) {
          vscode.postMessage({ type: t.dataset.type, iid: Number(t.dataset.iid), jobId: Number(t.dataset.id) });
          return;
        }
        if (t.tagName === 'BUTTON' && t.dataset.type) {
          var msg = {
            type: t.dataset.type,
            iid: Number(t.dataset.iid)
          };
          if (t.dataset.pid) { msg.pipelineId = Number(t.dataset.pid); }
          if (t.dataset.jobs) {
            msg.jobIds = t.dataset.jobs.split(',').map(function (x) { return Number(x); });
          }
          vscode.postMessage(msg);
        }
      });

      var cards = [];
      window.addEventListener('message', function (event) {
        var msg = event.data;
        if (msg.type === 'data') {
          cards = msg.cards;
          render(msg.cards, msg.message, msg.projectName);
        }
      });
    })();
  </script>
</body>
</html>`;
}
