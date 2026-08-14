import * as vscode from 'vscode';
import { GitLabClient, MR, MRDetail, ApprovalState, Job } from './gitlab';

export interface PipelineJob {
  id: number;
  name: string;
  status: string;
  playable: boolean;
}

export interface PipelineStage {
  name: string;
  status: string;
  jobs: PipelineJob[];
}

export interface PipelineInfo {
  id: number | null;
  status: string;
  stage: string;
  failedStage: string | null;
  stages: PipelineStage[];
}

export interface EnrichedMR extends MR {
  detail: MRDetail;
  pipeline: PipelineInfo;
  reviewCommentCount: number;
  lastNoteId: string;
  lastNoteAuthor: string;
  lastNoteBody: string;
  projectName: string;
  approvalsApproved: number;
  approvalsRequired: number;
}

export interface Snapshot {
  lastNoteId?: string;
  pipeStatus?: string;
  hasConflicts?: boolean;
  mergeStatus?: string;
}

export interface MonitorEvent {
  iid: number;
  title: string;
  webUrl: string;
  changes: string[];
  critical: boolean;
}

export interface MonitorResult {
  projectPath: string;
  mrs: EnrichedMR[];
  events: MonitorEvent[];
}

export function mrProjectName(mr: MR): string {
  const full = mr.references?.full || '';
  const idx = full.lastIndexOf('!');
  if (idx > -1) {
    return full.slice(0, idx);
  }
  return `project ${mr.project_id}`;
}

export function mrKey(mr: MR): string {
  return `P${mr.project_id}-MR${mr.iid}`;
}

const STAGE_SEVERITY = [
  'failed',
  'canceled',
  'blocked',
  'running',
  'pending',
  'waiting_for_resource',
  'preparing',
  'created',
  'manual',
  'scheduled',
  'skipped',
  'success',
];

function computeStages(
  jobs: Job[]
): { stages: PipelineStage[]; failedStage: string | null } {
  const byStage = new Map<string, PipelineStage>();
  for (const job of jobs) {
    const stage = job.stage || 'unknown';
    let entry = byStage.get(stage);
    if (!entry) {
      entry = { name: stage, status: 'success', jobs: [] };
      byStage.set(stage, entry);
    }
    entry.jobs.push({
      id: job.id,
      name: job.name,
      status: job.status || 'unknown',
      playable: job.playable === true || job.status === 'manual',
    });
  }
  const stages: PipelineStage[] = [];
  for (const entry of byStage.values()) {
    let worstIdx = STAGE_SEVERITY.indexOf('success');
    let worst = 'success';
    for (const job of entry.jobs) {
      const idx = STAGE_SEVERITY.indexOf(job.status);
      const eff = idx === -1 ? STAGE_SEVERITY.length : idx;
      if (eff < worstIdx) {
        worstIdx = eff;
        worst = job.status;
      }
    }
    entry.status = worst;
    stages.push(entry);
  }
  const failedStage = stages.find((s) => s.status === 'failed')?.name ?? null;
  return { stages, failedStage };
}

function computeApprovals(as: ApprovalState | undefined): {
  approved: number;
  required: number;
} {
  if (!as) {
    return { approved: 0, required: 0 };
  }
  const required = (as.rules || []).reduce((sum, r) => sum + (r.approvals_required || 0), 0);
  const users = new Set<string>();
  (as.approved_by || []).forEach((u) => {
    if (u.username) {
      users.add(u.username);
    }
  });
  (as.rules || []).forEach((r) =>
    (r.approved_by || []).forEach((u) => {
      if (u.username) {
        users.add(u.username);
      }
    })
  );
  return { approved: users.size, required };
}

export class MrMonitor {
  private static readonly SNAPSHOT_KEY = 'gitlabMr.snapshots';
  private static readonly LAST_DATA_KEY = 'gitlabMr.lastData';

  constructor(
    private context: vscode.ExtensionContext,
    private gitlab: GitLabClient
  ) {}

  private async save(snapshots: Record<string, Snapshot>): Promise<void> {
    await this.context.globalState.update(MrMonitor.SNAPSHOT_KEY, snapshots);
  }

  private loadLastData(): EnrichedMR[] {
    return this.context.globalState.get<EnrichedMR[]>(MrMonitor.LAST_DATA_KEY, []);
  }

  private async saveLastData(mrs: EnrichedMR[]): Promise<void> {
    await this.context.globalState.update(MrMonitor.LAST_DATA_KEY, mrs);
  }

  async run(projectPath: string, opts: { full?: boolean } = {}): Promise<MonitorResult> {
    const full = opts.full !== false;
    const prevEnriched = this.loadLastData();

    const me = await this.gitlab.getUser();
    const project = await this.gitlab.getProject(projectPath);
    const mrs = await this.gitlab.getProjectOpenMRs(project.id, me.id);

    const prev = this.context.globalState.get<Record<string, Snapshot>>(
      MrMonitor.SNAPSHOT_KEY,
      {}
    );
    const next: Record<string, Snapshot> = {};
    const events: MonitorEvent[] = [];
    const enriched: EnrichedMR[] = [];

    for (const mr of mrs) {
      const key = mrKey(mr);
      const cached = prevEnriched.find(
        (e) => e.iid === mr.iid && e.project_id === mr.project_id
      );

      let detail: MRDetail;
      if (full || !cached) {
        try {
          detail = await this.gitlab.getMRDetail(mr.project_id, mr.iid);
        } catch {
          continue;
        }
      } else {
        detail = cached.detail;
      }

      let pipeline: PipelineInfo = cached
        ? cached.pipeline
        : { id: null, status: 'unknown', stage: '', failedStage: null, stages: [] };
      if (full) {
        pipeline = { id: null, status: 'unknown', stage: '', failedStage: null, stages: [] };
        try {
          const pipes = await this.gitlab.getPipelines(mr.project_id, mr.iid);
          if (pipes.length > 0) {
            const first = pipes[0];
            pipeline = {
              id: first.id,
              status: first.status,
              stage: first.stage || '',
              failedStage: null,
              stages: [],
            };
            if (first.id) {
              try {
                const jobs = await this.gitlab.getPipelineJobs(mr.project_id, first.id);
                const { stages, failedStage } = computeStages(jobs);
                pipeline.stages = stages;
                pipeline.failedStage = failedStage;
              } catch {
                // jobs unavailable – keep stage list empty
              }
            }
          }
        } catch {
          // keep 'unknown'
        }
      }

      let approvalsApproved = cached ? cached.approvalsApproved : 0;
      let approvalsRequired = cached ? cached.approvalsRequired : 0;
      if (full) {
        approvalsApproved = 0;
        approvalsRequired = 0;
        try {
          const as = await this.gitlab.getApprovalState(mr.project_id, mr.iid);
          const a = computeApprovals(as);
          approvalsApproved = a.approved;
          approvalsRequired = a.required;
        } catch {
          // no approval data available
        }
      }

      let lastNoteId = cached ? cached.lastNoteId : '';
      let lastNoteAuthor = cached ? cached.lastNoteAuthor : '';
      let lastNoteBody = cached ? cached.lastNoteBody : '';
      let reviewCommentCount = cached ? cached.reviewCommentCount : 0;
      if (full) {
        lastNoteId = '';
        lastNoteAuthor = '';
        lastNoteBody = '';
        reviewCommentCount = 0;
        try {
          const notes = await this.gitlab.getNotes(mr.project_id, mr.iid);
          const last = notes.length > 0 ? notes[notes.length - 1] : undefined;
          if (last) {
            lastNoteId = String(last.id);
            lastNoteAuthor = last.author?.username || '';
            lastNoteBody = last.body || '';
          }
          reviewCommentCount = notes.filter((n) => !n.system).length;
        } catch {
          // keep empty
        }
      }

      const old = prev[key];
      const changes: string[] = [];
      let critical = false;
      if (old) {
        if (lastNoteId && old.lastNoteId && lastNoteId !== old.lastNoteId) {
          changes.push(`💬 New comment from ${lastNoteAuthor || 'someone'}`);
          if (lastNoteBody) {
            changes.push(`"${lastNoteBody.slice(0, 200)}"`);
          }
        }
        if (pipeline.status && old.pipeStatus && pipeline.status !== old.pipeStatus) {
          changes.push(`🔴 Pipeline status changed: ${pipeline.status}`);
        }
        if (
          detail.has_conflicts === true &&
          old.hasConflicts === false
        ) {
          changes.push('🚨 Merge conflict detected');
          critical = true;
        }
        if (
          detail.merge_status === 'cannot_be_merged' &&
          old.mergeStatus !== 'cannot_be_merged' &&
          old.mergeStatus
        ) {
          changes.push('⛔ MR cannot be merged');
          critical = true;
        }
      }

      next[key] = {
        lastNoteId,
        pipeStatus: pipeline.status,
        hasConflicts: detail.has_conflicts,
        mergeStatus: detail.merge_status,
      };

      enriched.push({
        ...mr,
        detail,
        pipeline,
        reviewCommentCount,
        lastNoteId,
        lastNoteAuthor,
        lastNoteBody,
        projectName: mrProjectName(mr),
        approvalsApproved,
        approvalsRequired,
      });

      if (changes.length > 0) {
        events.push({
          iid: mr.iid,
          title: mr.title,
          webUrl: mr.web_url,
          changes,
          critical,
        });
      }
    }

    await this.save(next);
    await this.saveLastData(enriched);
    return { projectPath: project.path_with_namespace, mrs: enriched, events };
  }
}
