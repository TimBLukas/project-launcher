import * as vscode from 'vscode';
import { Project } from './projectService';

type ProjectSection = 'saved' | 'history';

export interface ProjectQueryService {
	getSavedProjects(): Promise<Project[]>;
	getHistoryProjects(): Promise<Project[]>;
}

export class ProjectTreeItem extends vscode.TreeItem {
	public constructor(
		public readonly nodeType: 'section' | 'project',
		public readonly section: ProjectSection,
		public readonly project?: Project
	) {
		super(
			nodeType === 'section' ? (section === 'saved' ? 'Saved Projects' : 'Recent History') : (project?.name ?? ''),
			nodeType === 'section' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
		);

		if (nodeType === 'section') {
			this.contextValue = section === 'saved' ? 'section.saved' : 'section.history';
			this.iconPath = new vscode.ThemeIcon(section === 'saved' ? 'briefcase' : 'history');
			return;
		}

		if (!project) {
			throw new Error('Project tree item requires project data.');
		}

		this.contextValue =
			section === 'saved' ? (project.pinned ? 'project.saved.pinned' : 'project.saved.unpinned') : 'project.history';
		this.iconPath = new vscode.ThemeIcon(section === 'saved' && project.pinned ? 'star-full' : 'folder');
		this.description = `${project.type} • ${project.path}`;
		this.tooltip = [
			project.name,
			project.path,
			`Type: ${project.type}`,
			`Pinned: ${project.pinned ? 'yes' : 'no'}`,
			`Last accessed: ${new Date(project.lastAccessed).toLocaleString()}`
		].join('\n');
		this.command = {
			command: 'projectLauncher.openProject',
			title: 'Open Project',
			arguments: [this]
		};
	}
}

export class ProjectProvider implements vscode.TreeDataProvider<ProjectTreeItem>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ProjectTreeItem | undefined | void>();
	private readonly disposables: vscode.Disposable[] = [this.onDidChangeTreeDataEmitter];
	private filterQuery: string | undefined;

	public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	public constructor(private readonly projectService: ProjectQueryService) {}

	public dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	public refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
	}

	public setFilter(filterQuery: string | undefined): void {
		const normalizedQuery = normalizeFilterQuery(filterQuery);
		if (this.filterQuery === normalizedQuery) {
			return;
		}

		this.filterQuery = normalizedQuery;
		this.refresh();
	}

	public clearFilter(): void {
		this.setFilter(undefined);
	}

	public getFilter(): string | undefined {
		return this.filterQuery;
	}

	public async getChildren(element?: ProjectTreeItem): Promise<ProjectTreeItem[]> {
		if (!element) {
			return [new ProjectTreeItem('section', 'saved'), new ProjectTreeItem('section', 'history')];
		}

		if (element.nodeType !== 'section') {
			return [];
		}

		const projects =
			element.section === 'saved'
				? await this.projectService.getSavedProjects()
				: await this.projectService.getHistoryProjects();
		const visibleProjects = applyProjectFilter(projects, this.filterQuery);
		return visibleProjects.map((project) => new ProjectTreeItem('project', element.section, project));
	}

	public getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
		return element;
	}
}

function normalizeFilterQuery(filterQuery: string | undefined): string | undefined {
	if (filterQuery === undefined) {
		return undefined;
	}

	const normalizedValue = filterQuery.trim().toLowerCase();
	return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function applyProjectFilter(projects: Project[], filterQuery: string | undefined): Project[] {
	if (!filterQuery) {
		return projects;
	}

	return projects.filter((project) => projectMatchesFilter(project, filterQuery));
}

function projectMatchesFilter(project: Project, filterQuery: string): boolean {
	return (
		project.name.toLowerCase().includes(filterQuery) ||
		project.path.toLowerCase().includes(filterQuery) ||
		project.type.toLowerCase().includes(filterQuery)
	);
}
