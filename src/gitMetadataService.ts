import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { Project } from './projectService';

const execFileAsync = promisify(execFile);

export interface GitMetadata {
	repositoryRoot: string;
	branch: string;
	dirty: boolean;
	lastCommit: string;
}

interface CachedGitMetadata {
	metadata: GitMetadata | undefined;
	expiresAt: number;
}

export class GitMetadataService {
	private readonly cache = new Map<string, CachedGitMetadata>();

	public async getMetadata(project: Project, ttlMs: number): Promise<GitMetadata | undefined> {
		const projectRootPath = project.target === 'workspace' ? path.dirname(project.path) : project.path;
		const cacheKey = `${project.target}:${projectRootPath}`;
		const now = Date.now();
		const cachedEntry = this.cache.get(cacheKey);

		if (cachedEntry && cachedEntry.expiresAt > now) {
			return cachedEntry.metadata;
		}

		const metadata = await readGitMetadata(projectRootPath);
		this.cache.set(cacheKey, { metadata, expiresAt: now + ttlMs });
		return metadata;
	}
}

async function readGitMetadata(rootPath: string): Promise<GitMetadata | undefined> {
	try {
		const repositoryRoot = (await runGit(rootPath, ['rev-parse', '--show-toplevel'])).trim();
		if (repositoryRoot.length === 0) {
			return undefined;
		}

		const statusOutput = await runGit(repositoryRoot, ['status', '--porcelain', '--branch']);
		const statusLines = statusOutput.split('\n').filter((line) => line.trim().length > 0);
		const branchLine = statusLines[0] ?? '## unknown';
		const branch = extractBranch(branchLine);
		const dirty = statusLines.length > 1;
		const lastCommit = (await runGit(repositoryRoot, ['log', '-1', '--pretty=%h %s'])).trim();

		return {
			repositoryRoot,
			branch,
			dirty,
			lastCommit: lastCommit.length > 0 ? lastCommit : 'No commits'
		};
	} catch {
		return undefined;
	}
}

async function runGit(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 1024 * 1024 });
	return stdout;
}

function extractBranch(statusLine: string): string {
	const normalized = statusLine.startsWith('## ') ? statusLine.slice(3) : statusLine;
	const detachedPrefix = 'HEAD (no branch)';
	if (normalized.startsWith(detachedPrefix)) {
		return 'detached';
	}

	const branchName = normalized.split('...')[0].trim();
	return branchName.length > 0 ? branchName : 'unknown';
}
