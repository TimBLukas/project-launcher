import * as assert from 'assert';
import { ProjectProvider, ProjectTreeItem } from '../projectProvider';
import { Project } from '../projectService';

class FakeProjectQueryService {
	public constructor(
		private readonly savedProjects: Project[],
		private readonly historyProjects: Project[]
	) {}

	public async getSavedProjects(): Promise<Project[]> {
		return this.savedProjects;
	}

	public async getHistoryProjects(): Promise<Project[]> {
		return this.historyProjects;
	}
}

suite('ProjectProvider', () => {
	function createProject(
		id: string,
		name: string,
		type: Project['type'],
		lastAccessed: number,
		pinned = false
	): Project {
		return {
			id,
			name,
			type,
			path: `/tmp/${name}`,
			lastAccessed,
			pinned
		};
	}

	test('returns section nodes at root', async () => {
		const provider = new ProjectProvider(new FakeProjectQueryService([], []));
		const rootItems = await provider.getChildren();

		assert.strictEqual(rootItems.length, 2);
		assert.strictEqual(rootItems[0].nodeType, 'section');
		assert.strictEqual(rootItems[1].nodeType, 'section');
		assert.strictEqual(rootItems[0].section, 'saved');
		assert.strictEqual(rootItems[1].section, 'history');
	});

	test('filters projects by query across name, path and type', async () => {
		const saved = [
			createProject('1', 'frontend-react', 'React', 20),
			createProject('2', 'service-rust', 'Rust', 10)
		];
		const provider = new ProjectProvider(new FakeProjectQueryService(saved, []));
		const savedSection = new ProjectTreeItem('section', 'saved');

		provider.setFilter('react');
		const filteredItems = await provider.getChildren(savedSection);
		assert.strictEqual(filteredItems.length, 1);
		assert.strictEqual(filteredItems[0].project?.name, 'frontend-react');

		provider.clearFilter();
		const allItems = await provider.getChildren(savedSection);
		assert.strictEqual(allItems.length, 2);
	});

	test('applies dedicated context values for pinned and unpinned saved projects', () => {
		const pinnedProjectItem = new ProjectTreeItem(
			'project',
			'saved',
			createProject('saved-1', 'alpha', 'React', Date.now(), true)
		);
		const unpinnedProjectItem = new ProjectTreeItem(
			'project',
			'saved',
			createProject('saved-2', 'beta', 'Python', Date.now(), false)
		);

		assert.strictEqual(pinnedProjectItem.contextValue, 'project.saved.pinned');
		assert.strictEqual(unpinnedProjectItem.contextValue, 'project.saved.unpinned');
	});
});
