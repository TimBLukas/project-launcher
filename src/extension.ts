import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	console.log('Extension "projectfile-manager" is now active!');

	const disposable = vscode.commands.registerCommand('projectfile-manager.helloWorld', () => {

		// Show info message
		vscode.window.showInformationMessage('Test command executed successfully!');

		// Access active editor
		const editor = vscode.window.activeTextEditor;

		if (editor) {
			const doc = editor.document;

			// Insert sample text at cursor position
			editor.edit(editBuilder => {
				editBuilder.insert(editor.selection.active, '// VS Code extension test successful\n');
			});

			// Log file name
			console.log(`Active file: ${doc.fileName}`);
		} else {
			vscode.window.showWarningMessage('No active editor found.');
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {
	console.log('Extension deactivated.');
}