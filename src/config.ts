import * as vscode from 'vscode';

export interface ProjectLauncherConfig {
	maxHistoryEntries: number;
	maxProjectScanDepth: number;
	maxProjectScanDirectories: number;
	skipDirectories: string[];
	openInNewWindow: boolean;
	enableTypeDetectionCache: boolean;
	typeDetectionCacheTtlMs: number;
}

export interface ProjectConfigProvider {
	getConfig(): ProjectLauncherConfig;
}

export class VscodeProjectConfigProvider implements ProjectConfigProvider {
	public getConfig(): ProjectLauncherConfig {
		const configuration = vscode.workspace.getConfiguration('projectLauncher');

		return {
			maxHistoryEntries: readNumberSetting(configuration, 'maxHistoryEntries', 100, 1, 5000),
			maxProjectScanDepth: readNumberSetting(configuration, 'maxProjectScanDepth', 2, 0, 8),
			maxProjectScanDirectories: readNumberSetting(configuration, 'maxProjectScanDirectories', 250, 1, 10000),
			skipDirectories: readDirectoryList(configuration, 'skipDirectories', defaultSkipDirectories()),
			openInNewWindow: configuration.get<boolean>('openInNewWindow', false),
			enableTypeDetectionCache: configuration.get<boolean>('enableTypeDetectionCache', true),
			typeDetectionCacheTtlMs: readNumberSetting(configuration, 'typeDetectionCacheTtlMs', 300000, 1000, 3600000)
		};
	}
}

function readNumberSetting(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	fallback: number,
	min: number,
	max: number
): number {
	const rawValue = configuration.get<unknown>(key, fallback);
	if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, Math.floor(rawValue)));
}

function readDirectoryList(
	configuration: vscode.WorkspaceConfiguration,
	key: string,
	fallback: string[]
): string[] {
	const rawValue = configuration.get<unknown>(key, fallback);
	if (!Array.isArray(rawValue)) {
		return fallback;
	}

	const normalized = rawValue
		.filter((entry): entry is string => typeof entry === 'string')
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.length > 0);

	return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback;
}

function defaultSkipDirectories(): string[] {
	return ['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '.next', 'target'];
}
