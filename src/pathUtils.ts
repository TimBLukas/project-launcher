export function normalizePath(projectPath: string): string {
	return process.platform === 'win32' ? projectPath.toLowerCase() : projectPath;
}

export function comparePaths(leftPath: string, rightPath: string): boolean {
	return normalizePath(leftPath) === normalizePath(rightPath);
}

export function createProjectId(projectPath: string): string {
	return Buffer.from(normalizePath(projectPath)).toString('base64url');
}
