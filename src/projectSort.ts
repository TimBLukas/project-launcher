export type ProjectSortMode = 'lastAccessed' | 'name' | 'type' | 'path';

export interface SortableProject {
	name: string;
	type: string;
	path: string;
	lastAccessed: number;
	pinned?: boolean;
}

export function sortProjects<T extends SortableProject>(
	projects: T[],
	mode: ProjectSortMode,
	pinnedFirst: boolean
): T[] {
	const sortedProjects = [...projects].sort((left, right) => {
		if (mode === 'lastAccessed') {
			return right.lastAccessed - left.lastAccessed;
		}

		if (mode === 'name') {
			return compareCaseInsensitive(left.name, right.name);
		}

		if (mode === 'type') {
			const typeComparison = compareCaseInsensitive(left.type, right.type);
			return typeComparison !== 0 ? typeComparison : compareCaseInsensitive(left.name, right.name);
		}

		return compareCaseInsensitive(left.path, right.path);
	});

	if (!pinnedFirst) {
		return sortedProjects;
	}

	return sortedProjects.sort((left, right) => {
		const leftPinnedRank = left.pinned ? 0 : 1;
		const rightPinnedRank = right.pinned ? 0 : 1;
		return leftPinnedRank - rightPinnedRank;
	});
}

function compareCaseInsensitive(left: string, right: string): number {
	return left.localeCompare(right, undefined, { sensitivity: 'base' });
}
