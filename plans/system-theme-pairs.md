# System Theme Pairs

## Why

Users can choose one fixed theme today, including the terminal-derived `System` theme. There is no way to configure separate light and dark themes and have ghui pick between them based on the OS appearance.

## What We'd Ship

- Preserve existing fixed theme selection and the existing `System` terminal-palette theme.
- Add a follow-system mode that stores one dark theme and one light theme.
- Let the theme modal switch between fixed and follow-system modes without changing existing keybindings for fixed selection.
- Resolve the active theme from the detected system appearance when follow-system mode is enabled.

## API / Architecture Mapping

- Extend config with `themeMode`, `darkTheme`, and `lightTheme`, keeping `theme` as the fixed-mode theme.
- Add pure theme config helpers for normalization and theme resolution.
- Add OS appearance detection with safe fallbacks.
- Keep app-level `themeId` as the resolved active theme so downstream UI components remain unchanged.

## Open Questions

- Linux and Windows detection can be expanded after the macOS path is proven.
- A future version could watch OS appearance changes instead of polling periodically.

## Out Of Scope (For V1)

- Renaming the existing `System` theme.
- Removing or migrating existing `theme` config.
- Full desktop-environment-specific Linux detection coverage.

## Status

In progress.
