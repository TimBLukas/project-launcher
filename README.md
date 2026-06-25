# Project Launcher

Project Launcher adds a dedicated Activity Bar view to manage saved projects, workspace files, collections, and recent history.
(in vs code)

## Features
- Save the current workspace folder or `.code-workspace` file as a project.
- Auto-track opened workspace folders/files as recent history.
- Organize saved projects using **tags** and **collections**.
- Group saved projects by collection in the tree view.
- Choose sort mode: **last accessed**, **name**, **type**, or **path**.
- Open projects in multiple ways: current window, new window, split, or new workspace.
- Run configurable **custom terminal actions** per project.
- Show Git metadata in the tree (branch, dirty state, last commit).
- Quick-open saved/history projects via command palette with fuzzy matching.
- Export and import project data as JSON.

## Commands
- `Project Launcher: Add Current Project`
- `Project Launcher: Open Project`
- `Project Launcher: Open in Current Window`
- `Project Launcher: Open in New Window`
- `Project Launcher: Open in Split`
- `Project Launcher: Open in New Workspace`
- `Project Launcher: Quick Open`
- `Project Launcher: Remove Saved Project`
- `Project Launcher: Pin Saved Project`
- `Project Launcher: Unpin Saved Project`
- `Project Launcher: Edit Project Tags`
- `Project Launcher: Set Project Collection`
- `Project Launcher: Remove History Entry`
- `Project Launcher: Clear History`
- `Project Launcher: Filter Projects`
- `Project Launcher: Clear Project Filter`
- `Project Launcher: Set Sort Mode`
- `Project Launcher: Import Projects`
- `Project Launcher: Export Projects`
- `Project Launcher: Run Project Action`
- `Project Launcher: Refresh`

## Extension Settings
- `projectLauncher.maxHistoryEntries`: Maximum number of recent history entries retained.
- `projectLauncher.maxProjectScanDepth`: Maximum folder depth for project type detection.
- `projectLauncher.maxProjectScanDirectories`: Maximum number of directories scanned during detection.
- `projectLauncher.skipDirectories`: Directory names excluded from deep scanning.
- `projectLauncher.openInNewWindow`: Default behavior for `Open Project`.
- `projectLauncher.enableTypeDetectionCache`: Enable/disable project type detection cache.
- `projectLauncher.typeDetectionCacheTtlMs`: Cache lifetime for project type detection.
- `projectLauncher.sortMode`: Sort mode for tree and quick-open lists.
- `projectLauncher.groupSavedByCollection`: Group saved projects by collection.
- `projectLauncher.showGitMetadata`: Show Git metadata in tree descriptions/tooltips.
- `projectLauncher.gitMetadataCacheTtlMs`: Cache lifetime for Git metadata.
- `projectLauncher.customActions`: Custom terminal actions for projects.

## Import/Export Format

Exports create a JSON file with:
- `version`
- `exportedAt`
- `savedProjects`
- `historyProjects`

You can import with **merge** or **replace** strategy.

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
