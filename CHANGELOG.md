# Change Log

All notable changes to the "project-launcher" extension are documented in this file.

## [Unreleased]

- Added pinned saved projects with dedicated pin/unpin commands and menu actions.
- Added history management commands for removing individual entries and clearing the full history.
- Added project filtering commands for quickly narrowing tree entries.
- Added extension settings for history limits, scan depth, scan budget, skip directories, window-open behavior, and detection cache.
- Improved project type detection with a scan budget and in-memory cache.
- Refactored shared path normalization logic into a reusable utility module.
- Replaced sample tests with integration and unit tests for extension activation, provider behavior, project service logic, and detector behavior.
- Replaced template README with extension-specific documentation.
- Added CI workflow and VSIX packaging script.
