import * as vscode from 'vscode';
import * as path from 'path';
import { GitLabClient, Discussion, DiscussionNote } from './gitlab';
import { EnrichedMR } from './monitor';

export class MrCommentProvider {
  private controller: vscode.CommentController;
  private threads: vscode.CommentThread[] = [];

  constructor(private gitlab: GitLabClient) {
    this.controller = vscode.comments.createCommentController('gitlabMr', 'GitLab MR');
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: () => [],
    };
  }

  dispose(): void {
    this.clear();
    this.controller.dispose();
  }

  clear(): void {
    for (const t of this.threads) {
      t.dispose();
    }
    this.threads = [];
  }

  async showForMr(mr: EnrichedMR, repoRoot: string): Promise<void> {
    this.clear();
    let discussions: Discussion[];
    try {
      discussions = await this.gitlab.getDiscussions(mr.project_id, mr.iid);
    } catch {
      return;
    }
    for (const d of discussions) {
      const diffNote = d.notes.find((n) => n.position);
      if (!diffNote) {
        continue;
      }
      const pos = diffNote.position;
      if (!pos) {
        continue;
      }
      const filePath = pos.new_path;
      if (!filePath) {
        continue;
      }
      const line = pos.new_line ?? pos.head_line ?? pos.old_line;
      if (!line || line < 1) {
        continue;
      }
      const uri = vscode.Uri.file(path.join(repoRoot, filePath));
      const comments = d.notes
        .filter((n) => !n.system)
        .map((n) => this.toComment(n));
      if (comments.length === 0) {
        continue;
      }
      const thread = this.controller.createCommentThread(
        uri,
        new vscode.Range(line - 1, 0, line - 1, 0),
        comments
      );
      thread.canReply = false;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      const resolved = d.resolved ?? d.notes[0]?.resolved ?? false;
      thread.state = resolved
        ? vscode.CommentThreadState.Resolved
        : vscode.CommentThreadState.Unresolved;
      this.threads.push(thread);
    }
  }

  private toComment(n: DiscussionNote): vscode.Comment {
    const md = new vscode.MarkdownString(n.body);
    md.isTrusted = false;
    const authorName = n.author?.name && n.author.name.trim()
      ? `${n.author.name.trim()} @${n.author.username || 'unknown'}`
      : `@${n.author?.username || 'unknown'}`;
    return {
      body: md,
      author: {
        name: authorName,
      },
      label: 'GitLab MR',
      mode: vscode.CommentMode.Preview,
      timestamp: n.created_at ? new Date(n.created_at) : undefined,
    };
  }
}
