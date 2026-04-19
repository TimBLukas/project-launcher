import * as vscode from 'vscode';

export class InMemoryMemento implements vscode.Memento {
	private readonly state = new Map<string, unknown>();

	public keys(): readonly string[] {
		return [...this.state.keys()];
	}

	public get<T>(key: string): T | undefined;
	public get<T>(key: string, defaultValue: T): T;
	public get<T>(key: string, defaultValue?: T): T | undefined {
		if (!this.state.has(key)) {
			return defaultValue;
		}

		return this.state.get(key) as T;
	}

	public async update(key: string, value: unknown): Promise<void> {
		this.state.set(key, value);
	}
}

export function createTestExtensionContext(
	globalState: InMemoryMemento = new InMemoryMemento()
): vscode.ExtensionContext {
	const extensionGlobalState: vscode.Memento & { setKeysForSync(keys: readonly string[]): void } = {
		keys: () => globalState.keys(),
		get: <T>(key: string, defaultValue?: T): T | undefined => globalState.get(key, defaultValue),
		update: (key: string, value: unknown) => globalState.update(key, value),
		setKeysForSync: () => {}
	};

	const workspaceState = new InMemoryMemento();
	const extensionWorkspaceState: vscode.Memento = {
		keys: () => workspaceState.keys(),
		get: <T>(key: string, defaultValue?: T): T | undefined => workspaceState.get(key, defaultValue),
		update: (key: string, value: unknown) => workspaceState.update(key, value)
	};

	return {
		subscriptions: [],
		workspaceState: extensionWorkspaceState,
		globalState: extensionGlobalState,
		extensionUri: vscode.Uri.file(''),
		extensionPath: '',
		asAbsolutePath: (relativePath: string) => relativePath,
		storageUri: undefined,
		storagePath: undefined,
		globalStorageUri: vscode.Uri.file(''),
		globalStoragePath: '',
		logUri: vscode.Uri.file(''),
		logPath: '',
		extensionMode: vscode.ExtensionMode.Test,
		extension: undefined
	} as unknown as vscode.ExtensionContext;
}
