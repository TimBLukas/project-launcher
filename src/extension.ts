import * as vscode from 'vscode';
import { Project, ProjectService } from './projectService';
import { ProjectProvider, ProjectTreeItem } from './projectProvider';

interface ProjectSelection {
	project: Project;
	section: 'saved' | 'history';
}

interface ProjectQuickPickItem extends vscode.QuickPickItem {
	project: Project;
	section: 'saved' | 'history';
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const projectService = new ProjectService(context);
	const projectProvider = new ProjectProvider(projectService);

	const treeView = vscode.window.createTreeView('projectLauncherView', {
		treeDataProvider: projectProvider,
		showCollapseAll: true
	});

	context.subscriptions.push(projectProvider, treeView);

	registerCommand(context, 'projectLauncher.addCurrentProject', async () => {
		const currentWorkspace = getCurrentWorkspaceFolder();
		if (!currentWorkspace) {
			await vscode.window.showWarningMessage('Open a workspace folder before adding a saved project.');
			return;
		}

		await projectService.addToSaved(currentWorkspace.uri);
		await projectService.addToHistory(currentWorkspace.uri);
		projectProvider.refresh();
	});

	registerCommand(context, 'projectLauncher.openProject', async (...args: unknown[]) => {
		const item = toProjectTreeItem(args[0]);
		const selectedProject = await resolveProjectForOpen(projectService, item);
		if (!selectedProject) {
			return;
		}

		if (!(await projectService.isValidFolder(selectedProject.project.path))) {
			await vscode.window.showErrorMessage(`Project path no longer exists: ${selectedProject.project.path}`);
			projectProvider.refresh();
			return;
		}

		const projectUri = vscode.Uri.file(selectedProject.project.path);
		await projectService.addToHistory(projectUri);
		projectProvider.refresh();
		await vscode.commands.executeCommand('vscode.openFolder', projectUri, false);
	});

	registerCommand(context, 'projectLauncher.removeProject', async (...args: unknown[]) => {
		const item = toProjectTreeItem(args[0]);
		const selectedProject = await resolveProjectForRemoval(projectService, item);
		if (!selectedProject) {
			return;
		}

		await projectService.removeSavedProject(selectedProject.project.id);
		projectProvider.refresh();
	});

	registerCommand(context, 'projectLauncher.refresh', async () => {
		projectProvider.refresh();
	});

	await trackCurrentWorkspaceFolders(projectService, projectProvider);

	const workspaceFolderListener = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		void executeWithErrorSurface(async () => {
			await Promise.all(event.added.map((workspaceFolder) => projectService.addToHistory(workspaceFolder.uri)));
			projectProvider.refresh();
		});
	});

	context.subscriptions.push(workspaceFolderListener);
}

export function deactivate(): void {}

function registerCommand(
	context: vscode.ExtensionContext,
	commandId: string,
	handler: (...args: unknown[]) => Promise<void>
): void {
	const disposable = vscode.commands.registerCommand(commandId, (...args: unknown[]) =>
		void executeWithErrorSurface(async () => {
			await handler(...args);
		})
	);
	context.subscriptions.push(disposable);
}

async function executeWithErrorSurface(action: () => Promise<void>): Promise<void> {
	try {
		await action();
	} catch (error: unknown) {
		await vscode.window.showErrorMessage(errorMessage(error));
	}
}

async function trackCurrentWorkspaceFolders(
	projectService: ProjectService,
	projectProvider: ProjectProvider
): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	if (workspaceFolders.length === 0) {
		return;
	}

	await Promise.all(workspaceFolders.map((workspaceFolder) => projectService.addToHistory(workspaceFolder.uri)));
	projectProvider.refresh();
}

function getCurrentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;
	if (activeDocumentUri) {
		const activeWorkspace = vscode.workspace.getWorkspaceFolder(activeDocumentUri);
		if (activeWorkspace) {
			return activeWorkspace;
		}
	}

	return vscode.workspace.workspaceFolders?.[0];
}

async function resolveProjectForOpen(
	projectService: ProjectService,
	item?: ProjectTreeItem
): Promise<ProjectSelection | undefined> {
	if (item?.nodeType === 'project' && item.project) {
		return { project: item.project, section: item.section };
	}

	return pickProject(projectService, 'all');
}

async function resolveProjectForRemoval(
	projectService: ProjectService,
	item?: ProjectTreeItem
): Promise<ProjectSelection | undefined> {
	if (item?.nodeType === 'project' && item.section === 'saved' && item.project) {
		return { project: item.project, section: 'saved' };
	}

	if (item?.nodeType === 'project' && item.section === 'history') {
		await vscode.window.showWarningMessage('Only saved projects can be removed.');
		return undefined;
	}

	return pickProject(projectService, 'saved');
}

async function pickProject(
	projectService: ProjectService,
	selectionScope: 'saved' | 'all'
): Promise<ProjectSelection | undefined> {
	const savedProjects = await projectService.getSavedProjects();
	const historyProjects = selectionScope === 'all' ? await projectService.getHistoryProjects() : [];

	const items: ProjectQuickPickItem[] = [];
	for (const project of savedProjects) {
		items.push({
			label: project.name,
			description: `${project.type} • ${project.path}`,
			project,
			section: 'saved'
		});
	}

	if (selectionScope === 'all') {
		const savedPathSet = new Set(savedProjects.map((project) => normalizePath(project.path)));
		for (const project of historyProjects) {
			if (savedPathSet.has(normalizePath(project.path))) {
				continue;
			}

			items.push({
				label: project.name,
				description: `${project.type} • ${project.path}`,
				project,
				section: 'history'
			});
		}
	}

	if (items.length === 0) {
		const message =
			selectionScope === 'saved'
				? 'No saved projects are available.'
				: 'No saved projects or history entries are available.';
		await vscode.window.showInformationMessage(message);
		return undefined;
	}

	items.sort((left, right) => right.project.lastAccessed - left.project.lastAccessed);
	const selectedItem = await vscode.window.showQuickPick(items, {
		placeHolder: selectionScope === 'saved' ? 'Select a saved project' : 'Select a project to open'
	});

	if (!selectedItem) {
		return undefined;
	}

	return {
		project: selectedItem.project,
		section: selectedItem.section
	};
}

function normalizePath(projectPath: string): string {
	return process.platform === 'win32' ? projectPath.toLowerCase() : projectPath;
}

function toProjectTreeItem(value: unknown): ProjectTreeItem | undefined {
	return value instanceof ProjectTreeItem ? value : undefined;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.length > 0) {
		return error.message;
	}

	return `Unexpected error: ${String(error)}`;
}
