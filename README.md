# Project Launcher

Project Launcher adds a dedicated Activity Bar view to manage your saved projects and recent workspace history.

## Features

- Save the current workspace folder as a project.
- Auto-track workspace folders you open as recent history.
- Open any saved/history project from the tree view or command palette.
- Pin saved projects so they stay at the top of the saved list.
- Remove individual saved projects and history entries.
- Clear the full history list with one command.
- Filter tree entries by project name, type, or path.

## Commands

- `Project Launcher: Add Current Project`
- `Project Launcher: Open Project`
- `Project Launcher: Remove Saved Project`
- `Project Launcher: Pin Saved Project`
- `Project Launcher: Unpin Saved Project`
- `Project Launcher: Remove History Entry`
- `Project Launcher: Clear History`
- `Project Launcher: Filter Projects`
- `Project Launcher: Clear Project Filter`
- `Project Launcher: Refresh`

## Extension Settings

This extension contributes the following settings:

- `projectLauncher.maxHistoryEntries`: Maximum number of recent history entries retained.
- `projectLauncher.maxProjectScanDepth`: Maximum folder depth for project type detection.
- `projectLauncher.maxProjectScanDirectories`: Maximum number of directories scanned during detection.
- `projectLauncher.skipDirectories`: Directory names excluded from deep scanning.
- `projectLauncher.openInNewWindow`: Open selected projects in a new VS Code window.
- `projectLauncher.enableTypeDetectionCache`: Enable/disable project type detection cache.
- `projectLauncher.typeDetectionCacheTtlMs`: Cache lifetime for project type detection results in milliseconds.

## Development

```bash
npm ci
npm run compile
npm run lint
npm test
```

Create a VSIX package:

```bash
npm run package:vsix
```
