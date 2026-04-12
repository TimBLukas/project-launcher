import * as vscode from 'vscode';
import { Project, ProjectService } from './projectService';

type ProjectSection = 'saved' | 'history';

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

		this.contextValue = section === 'saved' ? 'project.saved' : 'project.history';
		this.iconPath = new vscode.ThemeIcon('folder');
		this.description = `${project.type} • ${project.path}`;
		this.tooltip = `${project.name}\n${project.path}\nType: ${project.type}\nLast accessed: ${new Date(project.lastAccessed).toLocaleString()}`;
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

	public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	public constructor(private readonly projectService: ProjectService) {}

	public dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	public refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
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

		return projects.map((project) => new ProjectTreeItem('project', element.section, project));
	}

	public getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
		return element;
	}
}
