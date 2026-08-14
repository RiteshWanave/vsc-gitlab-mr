import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new Error(`git ${args.join(' ')}: ${(err as Error).message}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export function projectPathFromRemote(url: string): string | null {
  let p = url.trim();
  if (p.includes('://')) {
    // URL forms: https://host/org/project.git or ssh://git@host[:port]/org/project.git
    const m = p.match(/^[a-z]+:\/\/[^/]+?\/(.+)$/i);
    if (!m) {
      return null;
    }
    p = m[1];
  } else {
    // SSH shorthand: git@host:org/project.git
    const m = p.match(/^[^@]+@[^:]+:(.+)$/);
    if (m) {
      p = m[1];
    }
  }
  p = p.replace(/\.git\/?$/, '').replace(/\/+$/, '');
  if (!p || p.startsWith('~') || p.startsWith('/') || p.includes('@')) {
    return null;
  }
  return p;
}

export async function getBranch(root: string): Promise<string> {
  return execGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export async function getOriginUrl(root: string): Promise<string> {
  return execGit(root, ['config', '--get', 'remote.origin.url']);
}

export function listTemplates(root: string): string[] {
  const dir = path.join(root, '.gitlab', 'merge_request_templates');
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .sort();
}

export function readTemplate(root: string, name: string): string {
  return fs.readFileSync(path.join(root, '.gitlab', 'merge_request_templates', name), 'utf8');
}

export function branchToTitle(branch: string): string {
  const cleaned = branch
    .replace(/^[^/]+\//, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : branch;
}

export interface ConventionalConfig {
  requireScopes: boolean;
  scopes: string[];
}

export function readConventionalCommits(root: string): ConventionalConfig | null {
  const file = path.join(root, 'conventionalCommits.json');
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ConventionalConfig>;
    return {
      requireScopes: raw.requireScopes === true,
      scopes: Array.isArray(raw.scopes) ? raw.scopes.filter((s) => typeof s === 'string') : [],
    };
  } catch {
    return null;
  }
}
