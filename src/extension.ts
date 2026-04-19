import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { VscodeProjectConfigProvider } from './config';
import { normalizePath } from './pathUtils';
import { sortProjects } from './projectSort';
import {
	ImportStrategy,
	Project,
	ProjectService,
	ProjectSnapshot,
	ProjectTargetKind,
	ProjectType
} from './projectService';
import { ProjectProvider, ProjectTreeItem } from './projectProvider';

interface ProjectSelection {
	project: Project;
	section: 'saved' | 'history';
}

interface ProjectQuickPickItem extends vscode.QuickPickItem {
	project: Project;
	section: 'saved' | 'history';
}

interface ProjectActionPickItem extends vscode.QuickPickItem {
	command: string;
}

type ProjectSelectionScope = 'saved' | 'history' | 'all';
type OpenMode = 'configured' | 'currentWindow' | 'newWindow' | 'split' | 'newWorkspace';

const configProvider = new VscodeProjectConfigProvider();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const projectService = new ProjectService(context);
	const projectProvider = new ProjectProvider(projectService);

	const treeView = vscode.window.createTreeView('projectLauncherView', {
		treeDataProvider: projectProvider,
		showCollapseAll: true
	});

	context.subscriptions.push(projectProvider, treeView);

	registerCommand(context, 'projectLauncher.addCurrentProject', async () => {
		const currentProjectUri = getCurrentProjectUri();
		if (!currentProjectUri) {
			await vscode.window.showWarningMessage('Open a workspace folder or a .code-workspace file before saving.');
			return;
		}

		await projectService.addToSaved(currentProjectUri);
		await projectService.addToHistory(currentProjectUri);
		projectProvider.refresh();
	});

	registerOpenCommand(context, 'projectLauncher.openProject', projectService, projectProvider, 'configured');
	registerOpenCommand(context, 'projectLauncher.openProjectCurrentWindow', projectService, projectProvider, 'currentWindow');
	registerOpenCommand(context, 'projectLauncher.openProjectNewWindow', projectService, projectProvider, 'newWindow');
	registerOpenCommand(context, 'projectLauncher.openProjectSplit', projectService, projectProvider, 'split');
	registerOpenCommand(context, 'projectLauncher.openProjectNewWorkspace', projectService, projectProvider, 'newWorkspace');

	registerCommand(context, 'projectLauncher.quickOpenProject', async () => {
		const allProjects = await projectService.getAllProjectsForQuickOpen();
		if (allProjects.length === 0) {
			await vscode.window.showInformationMessage('No saved projects or history entries are available.');
			return;
		}

		const sortMode = configProvider.getConfig().sortMode;
		const quickOpenItems = sortProjects(
			allProjects.map((entry) => entry.project),
			sortMode,
			true
		).map((project) => {
			const section = allProjects.find((entry) => entry.project.id === project.id)?.section ?? 'history';
			const tags = project.tags && project.tags.length > 0 ? ` • ${project.tags.map((tag) => `#${tag}`).join(' ')}` : '';
			return {
				label: `${section === 'saved' ? '$(star-full) ' : ''}${project.name}`,
				description: `${project.type} • ${project.path}`,
				detail: `${section.toUpperCase()} • ${project.collection ?? 'Uncategorized'}${tags}`,
				project,
				section
			} as ProjectQuickPickItem;
		});

		const selectedItem = await vscode.window.showQuickPick(quickOpenItems, {
			placeHolder: 'Quick open project',
			matchOnDescription: true,
			matchOnDetail: true
		});
		if (!selectedItem) {
			return;
		}

		await openSelection(projectService, projectProvider, { project: selectedItem.project, section: selectedItem.section }, 'configured');
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

	registerCommand(context, 'projectLauncher.pinProject', async (...args: unknown[]) => {
		const item = toProjectTreeItem(args[0]);
		const selectedProject = await resolveSavedProjectSelection(projectService, item, 'Select a project to pin');
		if (!selectedProject) {
			return;
		}

		await projectService.setSavedPinned(selectedProject.project.id, true);
		projectProvider.refresh();
	});

	registerCommand(context, 'projectLauncher.unpinProject', async (...args: unknown[]) => {
		const item = toProjectTreeItem(args[0]);
		const selectedProject = await resolveSavedProjectSelection(projectService, item, 'Select a project to unpin');
		if (!selectedProject) {
			return;
		}

		await projectService.setSavedPinned(selectedProject.project.id, false);
		projectProvider.refresh();
	});

	registerCommand(context, 'projectLauncher.editProjectTags', async (...args: unknown[]) => {
		const item = toProjectTreeItem(args[0]);
		const selectedProject = await resolveSavedProjectSelection(projectService, item, 'Select a saved project');
		if (!selectedProject) {
			return;
		}

		const currentTags = (selectedProject.project.tags ?? []).join(', ');
		const newTagInput = await vscode.window.showInputBox({
			prompt: 'Enter tags separated by commas',
			placeHolder: 'frontend, customer-a, backend',
			value: currentTags
		});
		if (newTagInput === undefined) {
			return;
		}

		await projectService.updateSavedTags(selectedProject.project.id, splitTagInput(newTagInput));
		projectProvider.refresh();
	});

	registerCommand(context, 'projectLauncher.setProjectCollection', async (...args: unknown[]) => {
		const item = toProjectTreeItem(args[0]);
		const selectedProject = await resolveSavedProjectSelection(projectService, item, 'Select a saved project');
		if (!selectedProject) {
			return;
		}

		const existingCollections = await projectService.getCollections();
		const quickPickItems = [
			...existingCollections.map((collectionName) => ({ label: collectionName })),
			{ label: '$(x) Clear collection', alwaysShow: true }
		];
		const pickedCollection = await vscode.window.showQuickPick(quickPickItems, {
			placeHolder: 'Choose a collection, or Esc to type a new one',
			ignoreFocusOut: true
		});

		let collection = selectedProject.project.collection;
		if (pickedCollection?.label === '$(x) Clear collection') {
			collection = undefined;
		} else if (pickedCollection?.label) {
			collection = pickedCollection.label;
		} else {
			const typedCollection = await vscode.window.showInputBox({
				prompt: 'Enter collection name (leave empty to clear)',
				value: selectedProject.project.collection ?? ''
			});
			if (typedCollection === undefined) {
				return;
			}

			collection = typedCollection.trim().length > 0 ? typedCollection.trim() : undefined;
		}

		await projectService.updateSavedCollection(selectedProject.project.id, collection);
		projectProvider.refresh();
	});

	registerCommand(context, 'projectLauncher.removeHistoryProject', async (...args: unknown[]) => {
		const item = toProjectTreeItem(args[0]);
		const selectedProject = await resolveHistoryProjectSelection(projectService, item);
		if (!selectedProject) {
			return;
		}

		await projectService.removeHistoryProject(selectedProject.project.id);
		projectProvider.refresh();
	});

	registerCommand(context, 'projectLauncher.clearHistory', async () => {
		const confirmation = await vscode.window.showWarningMessage(
			'Clear all recent history entries?',
			{ modal: true },
			'Clear History'
		);
		if (confirmation !== 'Clear History') {
			return;
		}

		await projectService.clearHistory();
		projectProvider.refresh();
	});

	registerCommand(context, 'projectLauncher.filterProjects', async () => {
		const selectedFilter = await vscode.window.showInputBox({
			prompt: 'Filter projects by name, path, type, collection, or tags',
			placeHolder: 'e.g. react, rust, customer-a, #backend',
			value: projectProvider.getFilter() ?? ''
		});
		if (selectedFilter === undefined) {
			return;
		}

		projectProvider.setFilter(selectedFilter);
	});

	registerCommand(context, 'projectLauncher.clearFilter', async () => {
		projectProvider.clearFilter();
	});

	registerCommand(context, 'projectLauncher.setSortMode', async () => {
		const sortMode = await vscode.window.showQuickPick(
			[
				{ label: 'Last Accessed', value: 'lastAccessed' },
				{ label: 'Name', value: 'name' },
				{ label: 'Type', value: 'type' },
				{ label: 'Path', value: 'path' }
			],
			{ placeHolder: 'Choose sort mode' }
		);
		if (!sortMode) {
			return;
		}

		await vscode.workspace.getConfiguration('projectLauncher').update('sortMode', sortMode.value, true);
		projectProvider.refresh();
	});

	registerCommand(context, 'projectLauncher.exportProjects', async () => {
		const snapshot = await projectService.exportSnapshot();
		const saveUri = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file(path.join(os.homedir(), 'project-launcher-export.json')),
			filters: { JSON: ['json'] }
		});
		if (!saveUri) {
			return;
		}

		await vscode.workspace.fs.writeFile(saveUri, Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8'));
		await vscode.window.showInformationMessage(`Exported project data to ${saveUri.fsPath}`);
	});

	registerCommand(context, 'projectLauncher.importProjects', async () => {
		const selection = await vscode.window.showOpenDialog({
			canSelectMany: false,
			filters: { JSON: ['json'] }
		});
		if (!selection || selection.length === 0) {
			return;
		}

		const strategy = await pickImportStrategy();
		if (!strategy) {
			return;
		}

		const rawFile = await vscode.workspace.fs.readFile(selection[0]);
		const parsed = JSON.parse(Buffer.from(rawFile).toString('utf8')) as unknown;
		const result = await projectService.importSnapshot(parsed, strategy);
		projectProvider.refresh();
		await vscode.window.showInformationMessage(
			`Imported project data (${result.savedCount} saved, ${result.historyCount} history).`
		);
	});

	registerCommand(context, 'projectLauncher.runProjectAction', async (...args: unknown[]) => {
		const item = toProjectTreeItem(args[0]);
		const selectedProject = await resolveProjectForOpen(projectService, item);
		if (!selectedProject) {
			return;
		}

		const action = await pickProjectAction(selectedProject.project);
		if (!action) {
			return;
		}

		const workingDirectory =
			selectedProject.project.target === 'workspace'
				? path.dirname(selectedProject.project.path)
				: selectedProject.project.path;

		const terminal = vscode.window.createTerminal({
			name: `Project Launcher: ${selectedProject.project.name}`,
			cwd: workingDirectory
		});
		terminal.show(true);
		terminal.sendText(interpolateProjectAction(action.command, selectedProject.project), true);
	});

	registerCommand(context, 'projectLauncher.refresh', async () => {
		projectProvider.refresh();
	});

	await trackCurrentWorkspace(projectService, projectProvider);

	const workspaceFolderListener = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		void executeWithErrorSurface(async () => {
			await Promise.all(event.added.map((workspaceFolder) => projectService.addToHistory(workspaceFolder.uri)));
			projectProvider.refresh();
		});
	});

	const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('projectLauncher')) {
			projectProvider.refresh();
		}
	});

	context.subscriptions.push(workspaceFolderListener, configListener);
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

function registerOpenCommand(
	context: vscode.ExtensionContext,
	commandId: string,
	projectService: ProjectService,
	projectProvider: ProjectProvider,
	openMode: OpenMode
): void {
	registerCommand(context, commandId, async (...args: unknown[]) => {
		const item = toProjectTreeItem(args[0]);
		const selectedProject = await resolveProjectForOpen(projectService, item);
		if (!selectedProject) {
			return;
		}

		await openSelection(projectService, projectProvider, selectedProject, openMode);
	});
}

async function openSelection(
	projectService: ProjectService,
	projectProvider: ProjectProvider,
	selectedProject: ProjectSelection,
	openMode: OpenMode
): Promise<void> {
	if (!(await projectService.isValidProjectTarget(selectedProject.project))) {
		await vscode.window.showErrorMessage(`Project path no longer exists: ${selectedProject.project.path}`);
		projectProvider.refresh();
		return;
	}

	await projectService.addExistingToHistory(selectedProject.project);
	projectProvider.refresh();
	await openProject(selectedProject.project, openMode);
}

async function openProject(project: Project, openMode: OpenMode): Promise<void> {
	const projectUri = vscode.Uri.file(project.path);

	if (openMode === 'split') {
		await openProjectInSplit(project, projectUri);
		return;
	}

	if (openMode === 'newWorkspace') {
		await openProjectInNewWorkspace(project, projectUri);
		return;
	}

	if (project.target === 'workspace' && openMode === 'currentWindow') {
		await vscode.commands.executeCommand('vscode.open', projectUri, {
			viewColumn: vscode.ViewColumn.Beside,
			preview: false
		});
		return;
	}

	const options = openFolderOptions(openMode);
	await vscode.commands.executeCommand('vscode.openFolder', projectUri, options);
}

async function openProjectInSplit(project: Project, projectUri: vscode.Uri): Promise<void> {
	if (project.target === 'workspace') {
		await vscode.commands.executeCommand('vscode.open', projectUri, {
			viewColumn: vscode.ViewColumn.Beside,
			preview: false
		});
		return;
	}

	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	if (workspaceFolders.some((folder) => compareWorkspaceFolder(folder.uri.fsPath, project.path))) {
		await vscode.window.showInformationMessage(`${project.name} is already part of the current workspace.`);
		return;
	}

	const added = vscode.workspace.updateWorkspaceFolders(workspaceFolders.length, 0, {
		uri: projectUri,
		name: project.name
	});
	if (!added) {
		throw new Error('Could not add the project folder to the current workspace.');
	}
}

async function openProjectInNewWorkspace(project: Project, projectUri: vscode.Uri): Promise<void> {
	if (project.target === 'workspace') {
		await vscode.commands.executeCommand('vscode.openFolder', projectUri, { forceNewWindow: true });
		return;
	}

	const workspaceDirectory = path.join(os.tmpdir(), 'project-launcher-workspaces');
	await fs.mkdir(workspaceDirectory, { recursive: true });
	const workspaceFilePath = path.join(
		workspaceDirectory,
		`${sanitizeFileName(project.name)}-${Date.now()}.code-workspace`
	);
	const workspaceContent = {
		folders: [{ path: project.path }],
		settings: {}
	};
	await fs.writeFile(workspaceFilePath, `${JSON.stringify(workspaceContent, null, 2)}\n`, 'utf8');
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspaceFilePath), { forceNewWindow: true });
}

function openFolderOptions(openMode: OpenMode): { forceNewWindow?: boolean; forceReuseWindow?: boolean } {
	if (openMode === 'newWindow') {
		return { forceNewWindow: true };
	}

	if (openMode === 'currentWindow') {
		return { forceReuseWindow: true };
	}

	return getOpenInNewWindowSetting() ? { forceNewWindow: true } : { forceReuseWindow: true };
}

async function executeWithErrorSurface(action: () => Promise<void>): Promise<void> {
	try {
		await action();
	} catch (error: unknown) {
		await vscode.window.showErrorMessage(errorMessage(error));
	}
}

async function trackCurrentWorkspace(projectService: ProjectService, projectProvider: ProjectProvider): Promise<void> {
	const workspaceFile = vscode.workspace.workspaceFile;
	if (workspaceFile && workspaceFile.scheme === 'file' && workspaceFile.fsPath.toLowerCase().endsWith('.code-workspace')) {
		await projectService.addToHistory(workspaceFile);
		projectProvider.refresh();
		return;
	}

	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	if (workspaceFolders.length === 0) {
		return;
	}

	await Promise.all(workspaceFolders.map((workspaceFolder) => projectService.addToHistory(workspaceFolder.uri)));
	projectProvider.refresh();
}

function getCurrentProjectUri(): vscode.Uri | undefined {
	const workspaceFile = vscode.workspace.workspaceFile;
	if (workspaceFile && workspaceFile.scheme === 'file' && workspaceFile.fsPath.toLowerCase().endsWith('.code-workspace')) {
		return workspaceFile;
	}

	const activeDocumentUri = vscode.window.activeTextEditor?.document.uri;
	if (activeDocumentUri) {
		const activeWorkspace = vscode.workspace.getWorkspaceFolder(activeDocumentUri);
		if (activeWorkspace) {
			return activeWorkspace.uri;
		}
	}

	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function resolveProjectForOpen(
	projectService: ProjectService,
	item?: ProjectTreeItem
): Promise<ProjectSelection | undefined> {
	if (item?.nodeType === 'project' && item.project) {
		return { project: item.project, section: item.section };
	}

	return pickProject(projectService, 'all', 'Select a project to open');
}

async function resolveProjectForRemoval(
	projectService: ProjectService,
	item?: ProjectTreeItem
): Promise<ProjectSelection | undefined> {
	if (item?.nodeType === 'project' && item.section === 'saved' && item.project) {
		return { project: item.project, section: 'saved' };
	}

	if (item?.nodeType === 'project' && item.section === 'history') {
		await vscode.window.showWarningMessage('Only saved projects can be removed from the saved list.');
		return undefined;
	}

	return pickProject(projectService, 'saved', 'Select a saved project to remove');
}

async function resolveSavedProjectSelection(
	projectService: ProjectService,
	item: ProjectTreeItem | undefined,
	placeHolder: string
): Promise<ProjectSelection | undefined> {
	if (item?.nodeType === 'project' && item.section === 'saved' && item.project) {
		return { project: item.project, section: 'saved' };
	}

	if (item?.nodeType === 'project' && item.section === 'history') {
		await vscode.window.showWarningMessage('Only saved projects are supported for this action.');
		return undefined;
	}

	return pickProject(projectService, 'saved', placeHolder);
}

async function resolveHistoryProjectSelection(
	projectService: ProjectService,
	item: ProjectTreeItem | undefined
): Promise<ProjectSelection | undefined> {
	if (item?.nodeType === 'project' && item.section === 'history' && item.project) {
		return { project: item.project, section: 'history' };
	}

	if (item?.nodeType === 'project' && item.section === 'saved') {
		await vscode.window.showWarningMessage('Only history entries can be removed from history.');
		return undefined;
	}

	return pickProject(projectService, 'history', 'Select a history entry to remove');
}

async function pickProject(
	projectService: ProjectService,
	selectionScope: ProjectSelectionScope,
	placeHolder: string
): Promise<ProjectSelection | undefined> {
	const savedProjects = selectionScope === 'history' ? [] : await projectService.getSavedProjects();
	const historyProjects = selectionScope === 'saved' ? [] : await projectService.getHistoryProjects();
	const sortMode = configProvider.getConfig().sortMode;
	const items: ProjectQuickPickItem[] = [];

	for (const project of sortProjects(savedProjects, sortMode, true)) {
		items.push({
			label: project.pinned ? `$(star-full) ${project.name}` : project.name,
			description: `${project.type} • ${project.path}`,
			detail: detailForProjectQuickPick(project, 'saved'),
			project,
			section: 'saved'
		});
	}

	if (selectionScope !== 'saved') {
		const savedPathSet = new Set(savedProjects.map((project) => normalizePath(project.path)));
		const visibleHistoryProjects = selectionScope === 'history'
			? historyProjects
			: historyProjects.filter((project) => !savedPathSet.has(normalizePath(project.path)));
		for (const project of sortProjects(visibleHistoryProjects, sortMode, false)) {
			items.push({
				label: project.name,
				description: `${project.type} • ${project.path}`,
				detail: detailForProjectQuickPick(project, 'history'),
				project,
				section: 'history'
			});
		}
	}

	if (items.length === 0) {
		await vscode.window.showInformationMessage(emptySelectionMessage(selectionScope));
		return undefined;
	}

	const selectedItem = await vscode.window.showQuickPick(items, {
		placeHolder,
		matchOnDescription: true,
		matchOnDetail: true
	});
	if (!selectedItem) {
		return undefined;
	}

	return {
		project: selectedItem.project,
		section: selectedItem.section
	};
}

function detailForProjectQuickPick(project: Project, section: 'saved' | 'history'): string {
	const details = [section.toUpperCase(), project.collection ?? 'Uncategorized', `Target: ${project.target}`];
	if (project.tags && project.tags.length > 0) {
		details.push(project.tags.map((tag) => `#${tag}`).join(' '));
	}

	return details.join(' • ');
}

function emptySelectionMessage(selectionScope: ProjectSelectionScope): string {
	if (selectionScope === 'saved') {
		return 'No saved projects are available.';
	}

	if (selectionScope === 'history') {
		return 'No history entries are available.';
	}

	return 'No saved projects or history entries are available.';
}

function toProjectTreeItem(value: unknown): ProjectTreeItem | undefined {
	return value instanceof ProjectTreeItem ? value : undefined;
}

function getOpenInNewWindowSetting(): boolean {
	return configProvider.getConfig().openInNewWindow;
}

function splitTagInput(input: string): string[] {
	return Array.from(
		new Set(
			input
				.split(',')
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 0)
		)
	);
}

async function pickImportStrategy(): Promise<ImportStrategy | undefined> {
	const selection = await vscode.window.showQuickPick(
		[
			{ label: 'Merge with existing projects', value: 'merge' as const },
			{ label: 'Replace existing projects', value: 'replace' as const }
		],
		{ placeHolder: 'Choose import strategy' }
	);

	return selection?.value;
}

async function pickProjectAction(project: Project): Promise<ProjectActionPickItem | undefined> {
	const customActions = configProvider
		.getConfig()
		.customActions.filter((action) => isActionAllowedForProject(action.projectTypes, action.targetKinds, project));

	if (customActions.length === 0) {
		await vscode.window.showInformationMessage('No project actions configured. Add entries to projectLauncher.customActions.');
		return undefined;
	}

	return vscode.window.showQuickPick(
		customActions.map((action) => ({
			label: action.label,
			description: action.command,
			command: action.command
		})),
		{ placeHolder: `Run action for ${project.name}` }
	);
}

function isActionAllowedForProject(
	projectTypes: string[] | undefined,
	targetKinds: string[] | undefined,
	project: Project
): boolean {
	if (projectTypes && projectTypes.length > 0 && !projectTypes.includes(project.type)) {
		return false;
	}

	if (targetKinds && targetKinds.length > 0 && !targetKinds.includes(project.target)) {
		return false;
	}

	return true;
}

function interpolateProjectAction(command: string, project: Project): string {
	const values: Record<string, string> = {
		projectPath: project.path,
		projectName: project.name,
		projectType: project.type,
		projectTarget: project.target,
		projectCollection: project.collection ?? '',
		projectTags: (project.tags ?? []).join(',')
	};

	let output = command;
	for (const [key, value] of Object.entries(values)) {
		output = output.split(`\${${key}}`).join(value);
	}

	return output;
}

function compareWorkspaceFolder(leftPath: string, rightPath: string): boolean {
	return normalizePath(leftPath) === normalizePath(rightPath);
}

function sanitizeFileName(value: string): string {
	return value.replace(/[^a-z0-9\-_]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
}

function errorMessage(error: unknown): string {
	if (error instanceof SyntaxError) {
		return 'Invalid JSON import file.';
	}

	if (error instanceof Error && error.message.length > 0) {
		return error.message;
	}

	return `Unexpected error: ${String(error)}`;
}
