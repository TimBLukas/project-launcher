import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ProjectLauncherConfig, ProjectConfigProvider } from '../config';
import { ProjectService } from '../projectService';
import { createTestExtensionContext } from './testContext';

class StaticConfigProvider implements ProjectConfigProvider {
	public constructor(private readonly config: ProjectLauncherConfig) {}

	public getConfig(): ProjectLauncherConfig {
		return this.config;
	}
}

suite('ProjectService', () => {
	const tempDirectories: string[] = [];

	async function createTempDirectory(name: string): Promise<string> {
		const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), `project-launcher-${name}-`));
		tempDirectories.push(tempDirectory);
		return tempDirectory;
	}

	async function createProjectDirectory(
		projectName: string,
		marker: 'react' | 'python' | 'rust' | 'go' | 'none' = 'none'
	): Promise<vscode.Uri> {
		const projectDirectory = await createTempDirectory(projectName);

		if (marker === 'react') {
			await fs.writeFile(
				path.join(projectDirectory, 'package.json'),
				JSON.stringify({ dependencies: { react: '^19.0.0' } }),
				'utf8'
			);
		}

		if (marker === 'python') {
			await fs.writeFile(path.join(projectDirectory, 'requirements.txt'), 'fastapi', 'utf8');
		}

		if (marker === 'rust') {
			await fs.writeFile(path.join(projectDirectory, 'Cargo.toml'), '[package]\nname="test"', 'utf8');
		}

		if (marker === 'go') {
			await fs.writeFile(path.join(projectDirectory, 'go.mod'), 'module example.com/test', 'utf8');
		}

		return vscode.Uri.file(projectDirectory);
	}

	async function createWorkspaceFile(workspaceName: string): Promise<vscode.Uri> {
		const workspaceDirectory = await createTempDirectory(`${workspaceName}-workspace`);
		const workspacePath = path.join(workspaceDirectory, `${workspaceName}.code-workspace`);
		await fs.writeFile(workspacePath, JSON.stringify({ folders: [{ path: '.' }] }, null, 2), 'utf8');
		return vscode.Uri.file(workspacePath);
	}

	function createService(config: Partial<ProjectLauncherConfig> = {}): ProjectService {
		const baseConfig: ProjectLauncherConfig = {
			maxHistoryEntries: 100,
			maxProjectScanDepth: 2,
			maxProjectScanDirectories: 250,
			skipDirectories: ['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '.next', 'target'],
			openInNewWindow: false,
			enableTypeDetectionCache: true,
			typeDetectionCacheTtlMs: 300000,
			sortMode: 'lastAccessed',
			groupSavedByCollection: true,
			showGitMetadata: true,
			gitMetadataCacheTtlMs: 30000,
			customActions: []
		};

		const context = createTestExtensionContext();
		return new ProjectService(context, new StaticConfigProvider({ ...baseConfig, ...config }));
	}

	teardown(async () => {
		await Promise.all(tempDirectories.map((directory) => fs.rm(directory, { recursive: true, force: true })));
		tempDirectories.length = 0;
	});

	test('keeps pinned saved projects at top', async () => {
		const service = createService();
		const alpha = await createProjectDirectory('alpha', 'react');
		const beta = await createProjectDirectory('beta', 'python');

		const alphaProject = await service.addToSaved(alpha);
		const betaProject = await service.addToSaved(beta);

		await service.setSavedPinned(alphaProject.id, true);

		const savedProjects = await service.getSavedProjects();
		assert.strictEqual(savedProjects.length, 2);
		assert.strictEqual(savedProjects[0].id, alphaProject.id);
		assert.strictEqual(savedProjects[0].pinned, true);
		assert.strictEqual(savedProjects[1].id, betaProject.id);
		assert.strictEqual(savedProjects[1].pinned, false);
	});

	test('supports tags and collections for saved projects', async () => {
		const service = createService();
		const projectUri = await createProjectDirectory('tagged', 'react');
		const savedProject = await service.addToSaved(projectUri);

		await service.updateSavedTags(savedProject.id, ['frontend', 'customer-a']);
		await service.updateSavedCollection(savedProject.id, 'Client Work');

		const updatedProject = (await service.getSavedProjects()).find((project) => project.id === savedProject.id);
		assert.ok(updatedProject);
		assert.deepStrictEqual(updatedProject?.tags, ['customer-a', 'frontend']);
		assert.strictEqual(updatedProject?.collection, 'Client Work');
	});

	test('limits history list and supports remove/clear', async () => {
		const service = createService({ maxHistoryEntries: 2 });
		const first = await createProjectDirectory('history-one', 'go');
		const second = await createProjectDirectory('history-two', 'rust');
		const third = await createProjectDirectory('history-three', 'python');

		const firstEntry = await service.addToHistory(first);
		await service.addToHistory(second);
		const thirdEntry = await service.addToHistory(third);

		const historyProjects = await service.getHistoryProjects();
		assert.strictEqual(historyProjects.length, 2);
		assert.strictEqual(historyProjects[0].id, thirdEntry.id);
		assert.ok(!historyProjects.some((project) => project.id === firstEntry.id));

		await service.removeHistoryProject(thirdEntry.id);
		const historyAfterRemove = await service.getHistoryProjects();
		assert.strictEqual(historyAfterRemove.length, 1);

		await service.clearHistory();
		const historyAfterClear = await service.getHistoryProjects();
		assert.strictEqual(historyAfterClear.length, 0);
	});

	test('detects .code-workspace entries and marks target as workspace', async () => {
		const service = createService();
		const workspaceUri = await createWorkspaceFile('main');
		const workspaceProject = await service.addToSaved(workspaceUri);

		assert.strictEqual(workspaceProject.target, 'workspace');
		assert.strictEqual(workspaceProject.type, 'Workspace');
		assert.ok(workspaceProject.path.endsWith('.code-workspace'));
	});

	test('exports and imports snapshots', async () => {
		const service = createService();
		const projectUri = await createProjectDirectory('snapshot', 'react');
		const savedProject = await service.addToSaved(projectUri);
		await service.updateSavedTags(savedProject.id, ['snapshot']);

		const snapshot = await service.exportSnapshot();
		const replacementService = createService();
		const result = await replacementService.importSnapshot(snapshot, 'replace');
		assert.strictEqual(result.savedCount, 1);
		assert.strictEqual(result.historyCount, 0);

		const importedProject = (await replacementService.getSavedProjects())[0];
		assert.deepStrictEqual(importedProject.tags, ['snapshot']);
	});

	test('removes stale entries when folder no longer exists', async () => {
		const service = createService();
		const tempProject = await createProjectDirectory('stale-project', 'none');
		await service.addToSaved(tempProject);

		await fs.rm(tempProject.fsPath, { recursive: true, force: true });
		const savedProjects = await service.getSavedProjects();
		assert.strictEqual(savedProjects.length, 0);
	});
});
