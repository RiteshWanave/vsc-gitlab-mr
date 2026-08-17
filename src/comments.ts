import * as vscode from 'vscode';
import * as path from 'path';
import { GitLabClient, Discussion, DiscussionNote } from './gitlab';
import { EnrichedMR } from './monitor';

export class MrCommentProvider {
  private controller: vscode.CommentController;
  private threads: vscode.CommentThread[] = [];
  private threadInfo = new Map<vscode.CommentThread, { discussionId: string; projectId: number; iid: number }>();

  constructor(private gitlab: GitLabClient) {
    this.controller = vscode.comments.createCommentController('gitlabMr', 'GitLab MR');
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: () => [],
    };
  }

  getThreadInfo(thread: vscode.CommentThread): { discussionId: string; projectId: number; iid: number } | undefined {
    return this.threadInfo.get(thread);
  }

  dispose(): void {
    this.clear();
    this.controller.dispose();
  }

  clear(): void {
    for (const t of this.threads) {
      this.threadInfo.delete(t);
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
      if (!diffNote?.position?.new_path) {
        continue;
      }
      const line = diffNote.position.new_line ?? diffNote.position.head_line ?? diffNote.position.old_line ?? 1;
      if (line < 1) { continue; }
      const uri = vscode.Uri.file(path.join(repoRoot, diffNote.position.new_path));
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
      const resolved = d.resolved ?? d.notes[0]?.resolved ?? false;
      thread.contextValue = resolved ? 'gitlabMr-thread-resolved' : 'gitlabMr-thread-unresolved';
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      thread.state = resolved
        ? vscode.CommentThreadState.Resolved
        : vscode.CommentThreadState.Unresolved;
      this.threadInfo.set(thread, { discussionId: d.id, projectId: mr.project_id, iid: mr.iid });
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
