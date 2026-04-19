import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ProjectConfigProvider, VscodeProjectConfigProvider } from './config';
import { comparePaths, createProjectId } from './pathUtils';
import { ProjectTypeDetector } from './projectTypeDetector';

export type ProjectType = 'React' | 'Python' | 'Rust' | 'Go' | 'Generic';

export interface Project {
	id: string;
	name: string;
	path: string;
	type: ProjectType;
	lastAccessed: number;
	pinned?: boolean;
}

type ProjectListKey = 'projectLauncher.savedProjects' | 'projectLauncher.historyProjects';

const SAVED_PROJECTS_KEY: ProjectListKey = 'projectLauncher.savedProjects';
const HISTORY_PROJECTS_KEY: ProjectListKey = 'projectLauncher.historyProjects';

export class ProjectService {
	public constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly configProvider: ProjectConfigProvider = new VscodeProjectConfigProvider(),
		private readonly projectTypeDetector: ProjectTypeDetector = new ProjectTypeDetector()
	) {}

	public async addToSaved(folderUri: vscode.Uri): Promise<Project> {
		const project = await this.createProject(folderUri.fsPath);
		return this.upsertProject(SAVED_PROJECTS_KEY, project);
	}

	public async addToHistory(folderUri: vscode.Uri): Promise<Project> {
		const project = await this.createProject(folderUri.fsPath);
		return this.upsertProject(HISTORY_PROJECTS_KEY, project);
	}

	public async removeSavedProject(projectId: string): Promise<void> {
		const projects = await this.readProjects(SAVED_PROJECTS_KEY);
		const nextProjects = projects.filter((project) => project.id !== projectId);
		await this.writeProjects(SAVED_PROJECTS_KEY, nextProjects);
	}

	public async setSavedPinned(projectId: string, pinned: boolean): Promise<Project | undefined> {
		const projects = await this.readProjects(SAVED_PROJECTS_KEY);
		const projectIndex = projects.findIndex((project) => project.id === projectId);
		if (projectIndex < 0) {
			return undefined;
		}

		const updatedProject: Project = {
			...projects[projectIndex],
			pinned
		};
		projects.splice(projectIndex, 1, updatedProject);
		await this.writeProjects(SAVED_PROJECTS_KEY, projects);
		return updatedProject;
	}

	public async removeHistoryProject(projectId: string): Promise<void> {
		const projects = await this.readProjects(HISTORY_PROJECTS_KEY);
		const nextProjects = projects.filter((project) => project.id !== projectId);
		await this.writeProjects(HISTORY_PROJECTS_KEY, nextProjects);
	}

	public async clearHistory(): Promise<void> {
		await this.writeProjects(HISTORY_PROJECTS_KEY, []);
	}

	public async getSavedProjects(): Promise<Project[]> {
		return this.readProjects(SAVED_PROJECTS_KEY);
	}

	public async getHistoryProjects(): Promise<Project[]> {
		return this.readProjects(HISTORY_PROJECTS_KEY);
	}

	public async isValidFolder(projectPath: string): Promise<boolean> {
		try {
			const stat = await fs.stat(projectPath);
			return stat.isDirectory();
		} catch (error: unknown) {
			if (isMissingPathError(error)) {
				return false;
			}

			throw error;
		}
	}

	private async createProject(folderPath: string): Promise<Project> {
		const resolvedPath = path.resolve(folderPath);
		if (!(await this.isValidFolder(resolvedPath))) {
			throw new Error(`Folder does not exist: ${resolvedPath}`);
		}

		const config = this.configProvider.getConfig();
		return {
			id: createProjectId(resolvedPath),
			name: path.basename(resolvedPath),
			path: resolvedPath,
			type: await this.projectTypeDetector.detect(resolvedPath, {
				maxDepth: config.maxProjectScanDepth,
				maxScanDirectories: config.maxProjectScanDirectories,
				skipDirectories: config.skipDirectories,
				useCache: config.enableTypeDetectionCache,
				cacheTtlMs: config.typeDetectionCacheTtlMs
			}),
			lastAccessed: Date.now(),
			pinned: false
		};
	}

	private async upsertProject(storageKey: ProjectListKey, incomingProject: Project): Promise<Project> {
		const projects = await this.readProjects(storageKey);
		const existingIndex = projects.findIndex((project) => comparePaths(project.path, incomingProject.path));

		if (existingIndex >= 0) {
			const existingProject = projects[existingIndex];
			const updatedProject: Project = {
				...existingProject,
				...incomingProject,
				id: existingProject.id,
				lastAccessed: Date.now(),
				pinned: storageKey === SAVED_PROJECTS_KEY ? existingProject.pinned ?? false : false
			};

			projects.splice(existingIndex, 1, updatedProject);
			await this.writeProjects(storageKey, projects);
			return updatedProject;
		}

		projects.unshift({
			...incomingProject,
			pinned: storageKey === SAVED_PROJECTS_KEY ? incomingProject.pinned ?? false : false
		});

		await this.writeProjects(storageKey, projects);
		const insertedProject = projects.find((project) => comparePaths(project.path, incomingProject.path));
		if (!insertedProject) {
			throw new Error('Failed to upsert project in storage.');
		}

		return insertedProject;
	}

	private async readProjects(storageKey: ProjectListKey): Promise<Project[]> {
		const rawValue = this.context.globalState.get<unknown>(storageKey, []);
		const parsedProjects = Array.isArray(rawValue) ? rawValue.filter(isProject) : [];
		const existingProjects = await this.filterExistingProjects(parsedProjects);
		const normalizedProjects = existingProjects.map((project) => ({
			...project,
			pinned: project.pinned ?? false
		}));
		const constrainedProjects = this.applyListConstraints(storageKey, normalizedProjects);

		if (!areProjectListsEqual(normalizedProjects, constrainedProjects) || parsedProjects.length !== constrainedProjects.length) {
			await this.writeProjects(storageKey, constrainedProjects);
		}

		return constrainedProjects;
	}

	private async writeProjects(storageKey: ProjectListKey, projects: Project[]): Promise<void> {
		await this.context.globalState.update(storageKey, this.applyListConstraints(storageKey, projects));
	}

	private applyListConstraints(storageKey: ProjectListKey, projects: Project[]): Project[] {
		const normalizedProjects = projects.map((project) => ({
			...project,
			pinned: storageKey === SAVED_PROJECTS_KEY ? project.pinned ?? false : false
		}));

		if (storageKey === SAVED_PROJECTS_KEY) {
			return sortSavedProjects(normalizedProjects);
		}

		const { maxHistoryEntries } = this.configProvider.getConfig();
		return sortByLastAccessed(normalizedProjects).slice(0, maxHistoryEntries);
	}

	private async filterExistingProjects(projects: Project[]): Promise<Project[]> {
		const existenceChecks = await Promise.all(
			projects.map(async (project) => ({
				project,
				exists: await this.isValidFolder(project.path)
			}))
		);

		return existenceChecks.filter((entry) => entry.exists).map((entry) => entry.project);
	}
}

function sortSavedProjects(projects: Project[]): Project[] {
	return [...projects].sort((left, right) => {
		const leftPinnedRank = left.pinned ? 0 : 1;
		const rightPinnedRank = right.pinned ? 0 : 1;
		if (leftPinnedRank !== rightPinnedRank) {
			return leftPinnedRank - rightPinnedRank;
		}

		return right.lastAccessed - left.lastAccessed;
	});
}

function sortByLastAccessed(projects: Project[]): Project[] {
	return [...projects].sort((left, right) => right.lastAccessed - left.lastAccessed);
}

function areProjectListsEqual(left: Project[], right: Project[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	return left.every((leftProject, index) => {
		const rightProject = right[index];
		return (
			leftProject.id === rightProject.id &&
			leftProject.name === rightProject.name &&
			leftProject.path === rightProject.path &&
			leftProject.type === rightProject.type &&
			leftProject.lastAccessed === rightProject.lastAccessed &&
			(leftProject.pinned ?? false) === (rightProject.pinned ?? false)
		);
	});
}

function isProject(value: unknown): value is Project {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value.id === 'string' &&
		typeof value.name === 'string' &&
		typeof value.path === 'string' &&
		isProjectType(value.type) &&
		typeof value.lastAccessed === 'number' &&
		(value.pinned === undefined || typeof value.pinned === 'boolean')
	);
}

function isProjectType(value: unknown): value is ProjectType {
	return value === 'React' || value === 'Python' || value === 'Rust' || value === 'Go' || value === 'Generic';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isMissingPathError(error: unknown): boolean {
	return isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === 'object' && error !== null && 'code' in error;
}
