import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ProjectConfigProvider, VscodeProjectConfigProvider } from './config';
import { comparePaths, createProjectId, normalizePath } from './pathUtils';
import { ProjectTypeDetector } from './projectTypeDetector';
import { sortProjects } from './projectSort';

export type ProjectTargetKind = 'folder' | 'workspace';
export type ProjectType = 'React' | 'Python' | 'Rust' | 'Go' | 'Generic' | 'Workspace';

export interface Project {
	id: string;
	name: string;
	path: string;
	target: ProjectTargetKind;
	type: ProjectType;
	lastAccessed: number;
	pinned?: boolean;
	tags?: string[];
	collection?: string;
}

export interface ProjectSnapshot {
	version: number;
	exportedAt: string;
	savedProjects: Project[];
	historyProjects: Project[];
}

export type ImportStrategy = 'replace' | 'merge';

export interface ImportResult {
	savedCount: number;
	historyCount: number;
}

type ProjectListKey = 'projectLauncher.savedProjects' | 'projectLauncher.historyProjects';

const SAVED_PROJECTS_KEY: ProjectListKey = 'projectLauncher.savedProjects';
const HISTORY_PROJECTS_KEY: ProjectListKey = 'projectLauncher.historyProjects';
const SNAPSHOT_VERSION = 2;

export class ProjectService {
	public constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly configProvider: ProjectConfigProvider = new VscodeProjectConfigProvider(),
		private readonly projectTypeDetector: ProjectTypeDetector = new ProjectTypeDetector()
	) {}

	public async addToSaved(targetUri: vscode.Uri): Promise<Project> {
		const project = await this.createProject(targetUri);
		return this.upsertProject(SAVED_PROJECTS_KEY, project);
	}

	public async addToHistory(targetUri: vscode.Uri): Promise<Project> {
		const project = await this.createProject(targetUri);
		return this.upsertProject(HISTORY_PROJECTS_KEY, project);
	}

	public async addExistingToHistory(project: Project): Promise<Project> {
		return this.upsertProject(HISTORY_PROJECTS_KEY, {
			...project,
			lastAccessed: Date.now(),
			pinned: false
		});
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

	public async updateSavedTags(projectId: string, tags: string[]): Promise<Project | undefined> {
		const normalizedTags = normalizeTags(tags);
		return this.updateSavedProject(projectId, { tags: normalizedTags });
	}

	public async updateSavedCollection(projectId: string, collection: string | undefined): Promise<Project | undefined> {
		const normalizedCollection = normalizeCollection(collection);
		return this.updateSavedProject(projectId, { collection: normalizedCollection });
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

	public async getCollections(): Promise<string[]> {
		const savedProjects = await this.getSavedProjects();
		const collectionSet = new Set(
			savedProjects
				.map((project) => normalizeCollection(project.collection))
				.filter((collection): collection is string => collection !== undefined)
		);

		return [...collectionSet].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
	}

	public async getAllProjectsForQuickOpen(): Promise<Array<{ section: 'saved' | 'history'; project: Project }>> {
		const savedProjects = await this.getSavedProjects();
		const historyProjects = await this.getHistoryProjects();
		const savedPathSet = new Set(savedProjects.map((project) => normalizePath(project.path)));

		return [
			...savedProjects.map((project) => ({ section: 'saved' as const, project })),
			...historyProjects
				.filter((project) => !savedPathSet.has(normalizePath(project.path)))
				.map((project) => ({ section: 'history' as const, project }))
		];
	}

	public async exportSnapshot(): Promise<ProjectSnapshot> {
		return {
			version: SNAPSHOT_VERSION,
			exportedAt: new Date().toISOString(),
			savedProjects: await this.getSavedProjects(),
			historyProjects: await this.getHistoryProjects()
		};
	}

	public async importSnapshot(rawSnapshot: unknown, strategy: ImportStrategy): Promise<ImportResult> {
		const snapshot = parseSnapshot(rawSnapshot);
		const incomingSaved = snapshot.savedProjects.map(normalizeProject);
		const incomingHistory = snapshot.historyProjects.map(normalizeProject);

		if (strategy === 'replace') {
			await this.writeProjects(SAVED_PROJECTS_KEY, incomingSaved);
			await this.writeProjects(HISTORY_PROJECTS_KEY, incomingHistory);
		} else {
			const existingSaved = await this.getSavedProjects();
			const existingHistory = await this.getHistoryProjects();
			await this.writeProjects(SAVED_PROJECTS_KEY, mergeProjects(existingSaved, incomingSaved, SAVED_PROJECTS_KEY));
			await this.writeProjects(HISTORY_PROJECTS_KEY, mergeProjects(existingHistory, incomingHistory, HISTORY_PROJECTS_KEY));
		}

		return {
			savedCount: (await this.getSavedProjects()).length,
			historyCount: (await this.getHistoryProjects()).length
		};
	}

	public async isValidProjectTarget(project: Pick<Project, 'path' | 'target'>): Promise<boolean> {
		try {
			const stat = await fs.stat(project.path);
			if (project.target === 'folder') {
				return stat.isDirectory();
			}

			return stat.isFile() && isWorkspaceFile(project.path);
		} catch (error: unknown) {
			if (isMissingPathError(error)) {
				return false;
			}

			throw error;
		}
	}

	private async updateSavedProject(projectId: string, updates: Partial<Project>): Promise<Project | undefined> {
		const projects = await this.readProjects(SAVED_PROJECTS_KEY);
		const projectIndex = projects.findIndex((project) => project.id === projectId);
		if (projectIndex < 0) {
			return undefined;
		}

		const updatedProject = normalizeProject({
			...projects[projectIndex],
			...updates
		});
		projects.splice(projectIndex, 1, updatedProject);
		await this.writeProjects(SAVED_PROJECTS_KEY, projects);
		return updatedProject;
	}

	private async createProject(targetUri: vscode.Uri): Promise<Project> {
		if (targetUri.scheme !== 'file') {
			throw new Error(`Unsupported project URI scheme: ${targetUri.scheme}`);
		}

		const resolvedPath = path.resolve(targetUri.fsPath);
		const target = await detectTargetKind(resolvedPath);
		const config = this.configProvider.getConfig();
		const projectType =
			target === 'workspace'
				? 'Workspace'
				: await this.projectTypeDetector.detect(resolvedPath, {
						maxDepth: config.maxProjectScanDepth,
						maxScanDirectories: config.maxProjectScanDirectories,
						skipDirectories: config.skipDirectories,
						useCache: config.enableTypeDetectionCache,
						cacheTtlMs: config.typeDetectionCacheTtlMs
					});

		return normalizeProject({
			id: createProjectId(resolvedPath),
			name: inferProjectName(resolvedPath, target),
			path: resolvedPath,
			target,
			type: projectType,
			lastAccessed: Date.now(),
			pinned: false,
			tags: [],
			collection: undefined
		});
	}

	private async upsertProject(storageKey: ProjectListKey, incomingProject: Project): Promise<Project> {
		const projects = await this.readProjects(storageKey);
		const existingIndex = projects.findIndex((project) => comparePaths(project.path, incomingProject.path));

		if (existingIndex >= 0) {
			const existingProject = projects[existingIndex];
			const updatedProject: Project = normalizeProject({
				...existingProject,
				...incomingProject,
				id: existingProject.id,
				lastAccessed: Date.now(),
				pinned: storageKey === SAVED_PROJECTS_KEY ? existingProject.pinned ?? false : false,
				tags: storageKey === SAVED_PROJECTS_KEY ? existingProject.tags : incomingProject.tags,
				collection: storageKey === SAVED_PROJECTS_KEY ? existingProject.collection : incomingProject.collection
			});

			projects.splice(existingIndex, 1, updatedProject);
			await this.writeProjects(storageKey, projects);
			return updatedProject;
		}

		let projectToInsert = normalizeProject({
			...incomingProject,
			pinned: storageKey === SAVED_PROJECTS_KEY ? incomingProject.pinned ?? false : false
		});

		if (storageKey === HISTORY_PROJECTS_KEY) {
			const savedProjects = await this.readProjects(SAVED_PROJECTS_KEY);
			const matchingSavedProject = savedProjects.find((project) => comparePaths(project.path, incomingProject.path));
			if (matchingSavedProject) {
				projectToInsert = normalizeProject({
					...projectToInsert,
					tags: matchingSavedProject.tags,
					collection: matchingSavedProject.collection
				});
			}
		}

		projects.unshift(projectToInsert);
		await this.writeProjects(storageKey, projects);
		return projectToInsert;
	}

	private async readProjects(storageKey: ProjectListKey): Promise<Project[]> {
		const rawValue = this.context.globalState.get<unknown>(storageKey, []);
		const parsedProjects = Array.isArray(rawValue) ? rawValue.map(parseStoredProject).filter(isDefined) : [];
		const existingProjects = await this.filterExistingProjects(parsedProjects);
		const constrainedProjects = this.applyListConstraints(storageKey, existingProjects);

		if (!areProjectListsEqual(parsedProjects, constrainedProjects)) {
			await this.writeProjects(storageKey, constrainedProjects);
		}

		return constrainedProjects;
	}

	private async writeProjects(storageKey: ProjectListKey, projects: Project[]): Promise<void> {
		await this.context.globalState.update(storageKey, this.applyListConstraints(storageKey, projects));
	}

	private applyListConstraints(storageKey: ProjectListKey, projects: Project[]): Project[] {
		const normalizedProjects = projects.map((project) => normalizeProject(project));

		if (storageKey === SAVED_PROJECTS_KEY) {
			return sortProjects(normalizedProjects, 'lastAccessed', true);
		}

		const { maxHistoryEntries } = this.configProvider.getConfig();
		return sortProjects(normalizedProjects, 'lastAccessed', false).slice(0, maxHistoryEntries);
	}

	private async filterExistingProjects(projects: Project[]): Promise<Project[]> {
		const existenceChecks = await Promise.all(
			projects.map(async (project) => ({
				project,
				exists: await this.isValidProjectTarget(project)
			}))
		);

		return existenceChecks.filter((entry) => entry.exists).map((entry) => entry.project);
	}
}

function parseStoredProject(value: unknown): Project | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const projectPath = typeof value.path === 'string' ? value.path : undefined;
	if (!projectPath) {
		return undefined;
	}

	const target = parseTargetKind(value.target, projectPath);
	const projectType = parseProjectType(value.type, target);
	const lastAccessed = typeof value.lastAccessed === 'number' ? value.lastAccessed : Date.now();
	const projectName =
		typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : inferProjectName(projectPath, target);
	const projectId = typeof value.id === 'string' && value.id.length > 0 ? value.id : createProjectId(projectPath);

	return normalizeProject({
		id: projectId,
		name: projectName,
		path: projectPath,
		target,
		type: projectType,
		lastAccessed,
		pinned: typeof value.pinned === 'boolean' ? value.pinned : false,
		tags: parseTags(value.tags),
		collection: normalizeCollection(typeof value.collection === 'string' ? value.collection : undefined)
	});
}

function parseSnapshot(rawSnapshot: unknown): ProjectSnapshot {
	if (!isRecord(rawSnapshot)) {
		throw new Error('Invalid import file: expected a JSON object.');
	}

	const savedProjects = Array.isArray(rawSnapshot.savedProjects)
		? rawSnapshot.savedProjects.map(parseStoredProject).filter(isDefined)
		: [];
	const historyProjects = Array.isArray(rawSnapshot.historyProjects)
		? rawSnapshot.historyProjects.map(parseStoredProject).filter(isDefined)
		: [];

	return {
		version: typeof rawSnapshot.version === 'number' ? rawSnapshot.version : 1,
		exportedAt: typeof rawSnapshot.exportedAt === 'string' ? rawSnapshot.exportedAt : new Date().toISOString(),
		savedProjects,
		historyProjects
	};
}

function mergeProjects(existing: Project[], incoming: Project[], storageKey: ProjectListKey): Project[] {
	const mergedMap = new Map<string, Project>();

	for (const project of [...existing, ...incoming]) {
		const mapKey = normalizePath(project.path);
		const existingProject = mergedMap.get(mapKey);
		if (!existingProject) {
			mergedMap.set(mapKey, normalizeProject(project));
			continue;
		}

		if (storageKey === SAVED_PROJECTS_KEY) {
			const newerProject = existingProject.lastAccessed >= project.lastAccessed ? existingProject : project;
			mergedMap.set(
				mapKey,
				normalizeProject({
					...newerProject,
					pinned: (existingProject.pinned ?? false) || (project.pinned ?? false),
					tags: Array.from(new Set([...(existingProject.tags ?? []), ...(project.tags ?? [])])),
					collection: normalizeCollection(project.collection) ?? normalizeCollection(existingProject.collection)
				})
			);
			continue;
		}

		mergedMap.set(
			mapKey,
			normalizeProject(existingProject.lastAccessed >= project.lastAccessed ? existingProject : project)
		);
	}

	return [...mergedMap.values()];
}

async function detectTargetKind(projectPath: string): Promise<ProjectTargetKind> {
	let stat: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stat = await fs.stat(projectPath);
	} catch (error: unknown) {
		if (isMissingPathError(error)) {
			throw new Error(`Project path no longer exists: ${projectPath}`);
		}

		throw error;
	}

	if (stat.isDirectory()) {
		return 'folder';
	}

	if (stat.isFile() && isWorkspaceFile(projectPath)) {
		return 'workspace';
	}

	throw new Error(`Only folders and .code-workspace files are supported: ${projectPath}`);
}

function inferProjectName(projectPath: string, target: ProjectTargetKind): string {
	if (target === 'workspace') {
		return path.basename(projectPath, '.code-workspace');
	}

	return path.basename(projectPath);
}

function isWorkspaceFile(projectPath: string): boolean {
	return projectPath.toLowerCase().endsWith('.code-workspace');
}

function normalizeProject(project: Project): Project {
	const target = parseTargetKind(project.target, project.path);
	return {
		...project,
		name: project.name.trim().length > 0 ? project.name : inferProjectName(project.path, target),
		target,
		type: parseProjectType(project.type, target),
		pinned: project.pinned ?? false,
		tags: normalizeTags(project.tags ?? []),
		collection: normalizeCollection(project.collection)
	};
}

function normalizeTags(tags: string[]): string[] {
	return Array.from(
		new Set(
			tags
				.filter((tag): tag is string => typeof tag === 'string')
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 0)
		)
	).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function parseTags(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return normalizeTags(value.filter((tag): tag is string => typeof tag === 'string'));
}

function normalizeCollection(collection: string | undefined): string | undefined {
	if (collection === undefined) {
		return undefined;
	}

	const normalizedCollection = collection.trim();
	return normalizedCollection.length > 0 ? normalizedCollection : undefined;
}

function parseTargetKind(value: unknown, projectPath: string): ProjectTargetKind {
	if (value === 'folder' || value === 'workspace') {
		return value;
	}

	return isWorkspaceFile(projectPath) ? 'workspace' : 'folder';
}

function parseProjectType(value: unknown, target: ProjectTargetKind): ProjectType {
	if (target === 'workspace') {
		return 'Workspace';
	}

	if (value === 'React' || value === 'Python' || value === 'Rust' || value === 'Go' || value === 'Generic') {
		return value;
	}

	return 'Generic';
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
			leftProject.target === rightProject.target &&
			leftProject.type === rightProject.type &&
			leftProject.lastAccessed === rightProject.lastAccessed &&
			(leftProject.pinned ?? false) === (rightProject.pinned ?? false) &&
			(leftProject.collection ?? '') === (rightProject.collection ?? '') &&
			JSON.stringify(leftProject.tags ?? []) === JSON.stringify(rightProject.tags ?? [])
		);
	});
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

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
