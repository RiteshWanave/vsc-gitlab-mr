export interface MR {
  iid: number;
  project_id: number;
  title: string;
  web_url: string;
  state: string;
  source_branch: string;
  target_branch: string;
  references?: { full?: string };
}

export interface MRDetail {
  iid: number;
  title: string;
  web_url: string;
  state: string;
  description: string;
  updated_at: string;
  has_conflicts: boolean;
  merge_status: string;
}

export interface Pipeline {
  id: number;
  status: string;
  stage?: string;
}

export interface Job {
  id: number;
  name: string;
  stage: string;
  status: string;
  playable?: boolean;
}

export interface DiscussionPosition {
  new_path?: string;
  new_line?: number | null;
  old_path?: string;
  old_line?: number | null;
  head_line?: number | null;
  line_range?: {
    start?: { new_line?: number | null; old_line?: number | null };
    end?: { new_line?: number | null; old_line?: number | null };
  };
}

export interface DiscussionNote {
  id: number;
  type?: string;
  body: string;
  system?: boolean;
  resolved?: boolean;
  author?: { username?: string; name?: string };
  position?: DiscussionPosition;
  created_at?: string;
}

export interface Discussion {
  id: string;
  individual_note?: boolean;
  resolvable?: boolean;
  resolved?: boolean;
  notes: DiscussionNote[];
}

export interface ProjectInfo {
  id: number;
  path_with_namespace: string;
  default_branch: string;
  web_url: string;
  name: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
}

export interface UserInfo {
  id: number;
  username: string;
}

export interface ApprovalRule {
  approvals_required?: number;
  approved_by?: { username?: string }[];
}

export interface ApprovalState {
  approved?: boolean;
  approved_by?: { username?: string }[];
  rules?: ApprovalRule[];
}

export interface CreateMrParams {
  source_branch: string;
  target_branch: string;
  title: string;
  description: string;
}

export class GitLabError extends Error {}

export class GitLabClient {
  constructor(
    private baseUrl: string,
    private token: string
  ) {}

  private async request<T>(p: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v4${p}`, {
        ...init,
        headers: {
          'PRIVATE-TOKEN': this.token,
          'Accept': 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch (err) {
      throw new GitLabError(`Network error contacting ${this.baseUrl}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new GitLabError(`GitLab API ${res.status} for ${p}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  getUser(): Promise<UserInfo> {
    return this.request<UserInfo>('/user');
  }

  getProject(path: string): Promise<ProjectInfo> {
    return this.request<ProjectInfo>(`/projects/${encodeURIComponent(path)}`);
  }

  searchProjects(search: string): Promise<ProjectInfo[]> {
    return this.request<ProjectInfo[]>(
      `/projects?membership=true&simple=true&order_by=last_activity_at&search=${encodeURIComponent(search)}&per_page=50`
    );
  }

  async getProjectOpenMRs(projectId: number, userId: number): Promise<MR[]> {
    const base = `/projects/${projectId}/merge_requests?scope=all&state=opened&per_page=100`;
    const [assigned, authored] = await Promise.all([
      this.request<MR[]>(`${base}&assignee_id=${userId}`),
      this.request<MR[]>(`${base}&author_id=${userId}`),
    ]);
    const seen = new Set<number>();
    const merged: MR[] = [];
    for (const mr of [...assigned, ...authored]) {
      if (seen.has(mr.iid)) {
        continue;
      }
      seen.add(mr.iid);
      merged.push(mr);
    }
    return merged;
  }

  getMRDetail(projectId: number, iid: number): Promise<MRDetail> {
    return this.request<MRDetail>(
      `/projects/${projectId}/merge_requests/${iid}`
    );
  }

  getPipelines(projectId: number, iid: number): Promise<Pipeline[]> {
    return this.request<Pipeline[]>(
      `/projects/${projectId}/merge_requests/${iid}/pipelines`
    );
  }

  getPipelineJobs(projectId: number, pipelineId: number): Promise<Job[]> {
    return this.request<Job[]>(
      `/projects/${projectId}/pipelines/${pipelineId}/jobs?per_page=100`
    );
  }

  createMrPipeline(projectId: number, mrIid: number): Promise<Pipeline> {
    return this.request<Pipeline>(
      `/projects/${projectId}/merge_requests/${mrIid}/pipelines`,
      { method: 'POST' }
    );
  }

  retryPipeline(projectId: number, pipelineId: number): Promise<Pipeline> {
    return this.request<Pipeline>(
      `/projects/${projectId}/pipelines/${pipelineId}/retry`,
      { method: 'POST' }
    );
  }

  playJob(projectId: number, jobId: number): Promise<Job> {
    return this.request<Job>(`/projects/${projectId}/jobs/${jobId}/play`, {
      method: 'POST',
    });
  }

  retryJob(projectId: number, jobId: number): Promise<Job> {
    return this.request<Job>(`/projects/${projectId}/jobs/${jobId}/retry`, {
      method: 'POST',
    });
  }

  getDiscussions(projectId: number, iid: number): Promise<Discussion[]> {
    return this.request<Discussion[]>(
      `/projects/${projectId}/merge_requests/${iid}/discussions?per_page=100`
    );
  }

  getApprovalState(projectId: number, iid: number): Promise<ApprovalState> {
    return this.request<ApprovalState>(
      `/projects/${projectId}/merge_requests/${iid}/approval_state`
    );
  }

  updateMR(
    projectId: number,
    iid: number,
    params: { title?: string; description?: string }
  ): Promise<MRDetail> {
    return this.request<MRDetail>(`/projects/${projectId}/merge_requests/${iid}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  createMR(projectId: number, params: CreateMrParams): Promise<MRDetail> {
    return this.request<MRDetail>(`/projects/${projectId}/merge_requests`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  postDiscussionNote(
    projectId: number,
    iid: number,
    discussionId: string,
    body: string
  ): Promise<DiscussionNote> {
    return this.request<DiscussionNote>(
      `/projects/${projectId}/merge_requests/${iid}/discussions/${discussionId}/notes`,
      { method: 'POST', body: JSON.stringify({ body }) }
    );
  }
}
