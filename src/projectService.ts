import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

export type ProjectType = 'React' | 'Python' | 'Rust' | 'Go' | 'Generic';

export interface Project {
	id: string;
	name: string;
	path: string;
	type: ProjectType;
	lastAccessed: number;
}

type ProjectListKey = 'projectLauncher.savedProjects' | 'projectLauncher.historyProjects';

const SAVED_PROJECTS_KEY: ProjectListKey = 'projectLauncher.savedProjects';
const HISTORY_PROJECTS_KEY: ProjectListKey = 'projectLauncher.historyProjects';
const MAX_DEEP_SCAN_DEPTH = 2;

export class ProjectService {
	public constructor(private readonly context: vscode.ExtensionContext) {}

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

		return {
			id: createProjectId(resolvedPath),
			name: path.basename(resolvedPath),
			path: resolvedPath,
			type: await detectProjectType(resolvedPath),
			lastAccessed: Date.now()
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
				lastAccessed: Date.now()
			};
			projects.splice(existingIndex, 1, updatedProject);
			await this.writeProjects(storageKey, projects);
			return updatedProject;
		}

		projects.unshift(incomingProject);
		await this.writeProjects(storageKey, projects);
		return incomingProject;
	}

	private async readProjects(storageKey: ProjectListKey): Promise<Project[]> {
		const rawValue = this.context.globalState.get<unknown>(storageKey, []);
		const parsedProjects = Array.isArray(rawValue) ? rawValue.filter(isProject) : [];
		const validProjects = await this.filterExistingProjects(parsedProjects);
		const sortedProjects = sortByLastAccessed(validProjects);

		if (sortedProjects.length !== parsedProjects.length) {
			await this.writeProjects(storageKey, sortedProjects);
		}

		return sortedProjects;
	}

	private async writeProjects(storageKey: ProjectListKey, projects: Project[]): Promise<void> {
		await this.context.globalState.update(storageKey, sortByLastAccessed(projects));
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

export async function detectProjectType(rootPath: string): Promise<ProjectType> {
	const rootMarker = await detectMarkerAtDirectory(rootPath);

	if (rootMarker !== undefined) {
		return rootMarker;
	}

	const queue: Array<{ directory: string; depth: number }> = [{ directory: rootPath, depth: 0 }];

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) {
			continue;
		}

		if (current.depth >= MAX_DEEP_SCAN_DEPTH) {
			continue;
		}

		const childDirectories = await readChildDirectories(current.directory);

		for (const childDirectory of childDirectories) {
			const detectedMarker = await detectMarkerAtDirectory(childDirectory);
			if (detectedMarker !== undefined) {
				return detectedMarker;
			}

			queue.push({ directory: childDirectory, depth: current.depth + 1 });
		}
	}

	return 'Generic';
}

async function detectMarkerAtDirectory(directoryPath: string): Promise<ProjectType | undefined> {
	const packageJsonPath = path.join(directoryPath, 'package.json');
	if (await fileExists(packageJsonPath)) {
		return detectNodeProjectType(packageJsonPath);
	}

	const requirementsPath = path.join(directoryPath, 'requirements.txt');
	if (await fileExists(requirementsPath)) {
		return 'Python';
	}

	const pyprojectPath = path.join(directoryPath, 'pyproject.toml');
	if (await fileExists(pyprojectPath)) {
		return 'Python';
	}

	const cargoTomlPath = path.join(directoryPath, 'Cargo.toml');
	if (await fileExists(cargoTomlPath)) {
		return 'Rust';
	}

	const goModPath = path.join(directoryPath, 'go.mod');
	if (await fileExists(goModPath)) {
		return 'Go';
	}

	return undefined;
}

async function detectNodeProjectType(packageJsonPath: string): Promise<ProjectType> {
	const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
	let parsedPackage: unknown = undefined;

	try {
		parsedPackage = JSON.parse(packageJsonContent);
	} catch (error: unknown) {
		if (error instanceof SyntaxError) {
			return 'Generic';
		}
		throw error;
	}

	const dependencies = {
		...readDependencyMap(parsedPackage, 'dependencies'),
		...readDependencyMap(parsedPackage, 'devDependencies')
	};

	if (hasOwn(dependencies, 'react') || hasOwn(dependencies, 'next')) {
		return 'React';
	}

	return 'Generic';
}

function readDependencyMap(packageJson: unknown, key: 'dependencies' | 'devDependencies'): Record<string, string> {
	if (!isRecord(packageJson)) {
		return {};
	}

	const rawDependencies = packageJson[key];
	if (!isRecord(rawDependencies)) {
		return {};
	}

	const dependencies: Record<string, string> = {};
	for (const [name, version] of Object.entries(rawDependencies)) {
		if (typeof version === 'string') {
			dependencies[name] = version;
		}
	}

	return dependencies;
}

async function readChildDirectories(directoryPath: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(directoryPath, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory() && !shouldSkipDirectory(entry.name))
			.map((entry) => path.join(directoryPath, entry.name));
	} catch (error: unknown) {
		if (isDirectoryReadError(error)) {
			return [];
		}

		throw error;
	}
}

function shouldSkipDirectory(directoryName: string): boolean {
	return directoryName === 'node_modules' || directoryName === '.git';
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch (error: unknown) {
		if (isMissingPathError(error)) {
			return false;
		}

		throw error;
	}
}

function createProjectId(projectPath: string): string {
	const normalizedPath = normalizePath(projectPath);
	return Buffer.from(normalizedPath).toString('base64url');
}

function normalizePath(projectPath: string): string {
	return process.platform === 'win32' ? projectPath.toLowerCase() : projectPath;
}

function comparePaths(leftPath: string, rightPath: string): boolean {
	return normalizePath(leftPath) === normalizePath(rightPath);
}

function sortByLastAccessed(projects: Project[]): Project[] {
	return [...projects].sort((left, right) => right.lastAccessed - left.lastAccessed);
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
		typeof value.lastAccessed === 'number'
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

function isDirectoryReadError(error: unknown): boolean {
	return isNodeError(error) && (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === 'object' && error !== null && 'code' in error;
}

function hasOwn(record: Record<string, string>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}
