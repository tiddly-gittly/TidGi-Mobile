# Git Mobile Sync Refactor

This document describes the current Git-based mobile sync architecture shared by TidGi-Mobile, TidGi-Desktop, and the tw-mobile-sync TiddlyWiki plugin.

Related issue:

- https://github.com/tiddly-gittly/TidGi-Mobile/issues/88

## Goals

1. Store mobile workspaces as Git-backed filesystem folders instead of SQLite databases.
2. Let TidGi-Desktop expose Git and archive endpoints through the tw-mobile-sync plugin.
3. Keep TiddlyWiki boot fast on mobile by streaming filesystem tiddlers into a skinny HTML shell.
4. Share routing and workspace metadata through tidgi.config.json while allowing each platform to ignore unknown fields.

## Current Architecture

### Desktop side

TidGi-Desktop owns the real repository and exposes three classes of functionality to the TiddlyWiki plugin:

- Git Smart HTTP endpoints for fetch and push.
- A full-archive endpoint that packages the current repository state plus the minimal .git metadata needed on mobile.
- Generic git and workspace file primitives used by the plugin for bundle receive, merge, archive generation, and conflict resolution.

The plugin no longer resolves repository paths or validates tokens by itself. It delegates those decisions to Desktop services via IPC.

### Mobile side

TidGi-Mobile imports a workspace by downloading either:

- the full-archive tarball fast path, or
- the Git fallback path when the archive endpoint is unavailable.

After import, mobile reads .tid, .meta, .json, and attachment files directly from the local repository folder and injects them into WebView.

### WebView boot path

The TiddlyWiki runtime starts from a prebuilt skinny HTML file bundled in the app:

- assets/tiddlywiki/tiddlywiki-empty.html

Then mobile:

1. scans repository tiddler files,
2. parses them on the native and JS hybrid path,
3. streams tiddler store chunks into WebView,
4. lets TiddlyWiki boot against the injected store.

## Data Flow

### Import

1. User scans or pastes mobile sync info.
2. Mobile creates a local workspace entry.
3. Mobile tries GET /tw-mobile-sync/git/{workspaceId}/full-archive.
4. On success, mobile downloads and extracts the tar archive.
5. Mobile rewrites the local Git remote to the real desktop endpoint.
6. On failure or 404, mobile falls back to Git clone.

### Sync

1. Mobile commits local filesystem changes into its local Git repository.
2. Mobile creates a git bundle and uploads it to `POST /tw-mobile-sync/git/{workspaceId}/receive-bundle`.
3. Mobile triggers `POST /tw-mobile-sync/git/{workspaceId}/merge-incoming` so desktop merges `mobile-incoming` into its main branch.
4. Mobile requests `POST /tw-mobile-sync/git/{workspaceId}/create-bundle` to fetch desktop's merged result.
5. Mobile fetches the returned bundle into `origin/<branch>` and updates its working tree to match the merged desktop state.

### Saving tiddlers

1. TiddlyWiki syncadaptor decides the routing target in WebView.
2. FileSystemWikiStorageService writes the tiddler into the target workspace folder.
3. The service updates its local title-to-file-path registry.
4. Git status and history views inspect the repository on disk.

## Major Components

### TidGi-Desktop

Relevant areas:

- src/services/gitServer/index.ts
- src/services/workspaces/
- IPC service descriptors used by tw-mobile-sync

Responsibilities:

- map workspace IDs to repository paths,
- validate workspace tokens,
- serve Git Smart HTTP,
- generate cached full-archive tarballs.

### tw-mobile-sync

Responsibilities:

- expose TiddlyWiki server routes,
- forward Git and archive requests to Desktop,
- keep the skinny HTML endpoint available,
- stay thin and avoid duplicate repository or auth logic.

Main route families:

- GET /tw-mobile-sync/get-skinny-html
- GET /tw-mobile-sync/git/mobile-sync-info
- GET /tw-mobile-sync/git/{workspaceId}/info/refs
- POST /tw-mobile-sync/git/{workspaceId}/git-upload-pack
- POST /tw-mobile-sync/git/{workspaceId}/git-receive-pack
- POST /tw-mobile-sync/git/{workspaceId}/receive-bundle
- POST /tw-mobile-sync/git/{workspaceId}/create-bundle
- POST /tw-mobile-sync/git/{workspaceId}/merge-incoming
- GET /tw-mobile-sync/git/{workspaceId}/full-archive
- GET /tw-mobile-sync/git/{workspaceId}/pack-size

### TidGi-Mobile

Key code paths:

- src/services/GitService/index.ts
- src/services/GitService/useGitImport.ts
- src/services/WikiStorageService/FileSystemWikiStorageService.ts
- src/pages/WikiWebView/useStreamChunksToWebView/FileSystemTiddlersReadStream.ts
- plugins/src/expo-file-system-syncadaptor/file-system-syncadaptor.ts

Responsibilities:

- import repositories,
- read and write tiddlers on disk,
- route tiddlers to main or sub-workspaces,
- serialize sync attempts per local repository while still supporting multiple configured desktops,
- present Git history, uncommitted changes, and sync actions.

## Routing Model

Routing decisions happen in WebView because only WebView has direct access to TiddlyWiki filter evaluation.

Routing inputs:

- workspace order,
- tagNames,
- includeTagTree,
- fileSystemPathFilter and custom filter rules.

Routing result:

- target workspace ID, or
- fallback to the main workspace.

The storage layer only performs the actual write once the target workspace has been resolved.

## tidgi.config.json

This file lives in each workspace repository and is synced through Git.

Rules:

- platforms must preserve unknown fields,
- each platform only edits fields it understands,
- changing routing config does not proactively move old files,
- files are re-routed when they are next saved.

Known mobile-facing fields include:

- name
- tagNames
- includeTagTree
- customFilters
- fileSystemPathFilters

## Fast Load Strategy

The current load path is optimized around two expensive operations:

1. repository import,
2. TiddlyWiki boot from many filesystem tiddlers.

Current optimizations:

- full-archive avoids expensive JS Git clone on LAN.
- Android native recursive directory scan avoids slow JS directory walking.
- Android native batch parsing reduces bridge round-trips.
- WebView receives tiddlers in chunks instead of one huge payload.

## Git History Notes

There are two different concepts in the mobile UI:

- commit history for a specific repository,
- uncommitted filesystem changes for one or more related repositories.

This distinction matters because a main workspace can load content from sub-workspaces, while each sub-workspace is still a separate Git repository.

The current direction is:

- commit history stays repository-specific,
- uncommitted changes can aggregate related sub-workspaces when the main workspace includes them.

## Known Risks

1. statusMatrix on Android remains expensive for large repositories and should not run eagerly on every screen.
2. Main workspaces and sub-workspaces share one visible wiki in WebView but remain separate Git repositories, so Git UI must be explicit about scope.
3. The bundled skinny HTML file is a forked runtime artifact, so boot-level patches must stay minimal and be reviewed against upstream TiddlyWiki behavior.
4. Archive import is fast, but it shifts correctness pressure onto tar generation and extraction paths.
5. `.tid` conflict resolution now performs a 3-way body merge, but overlapping text edits can still degrade into conflict-marked fallback text when diff-match-patch cannot apply both sides cleanly.
6. Mobile sync now serializes per-workspace multi-server operations to avoid local Git races, but different workspaces may still sync concurrently.

## Recommended Debugging Checklist

When mobile content looks correct in WebView but Git UI looks wrong:

1. Confirm the save path and routed target workspace in syncadaptor logs.
2. Inspect gitDiffChangedFiles logs for the repository actually receiving the file.
3. Verify whether the changed tiddler was routed into a sub-workspace.
4. Compare repository-specific history with the workspace currently displayed in WebView.

When TiddlyWiki boot emits module warnings:

1. Compare assets/tiddlywiki/tiddlywiki-empty.html against upstream boot.js.
2. Inspect whether non-JavaScript shadow tiddlers are being registered as modules.
3. Prefer fixing registration-time filtering over execute-time skipping.

## File Index

Desktop:

- src/services/gitServer/index.ts
- src/services/workspaces/interface.ts
- src/services/workspaces/index.ts

Plugin:

- src/tw-mobile-sync/server/Git/
- src/tw-mobile-sync/server/SaveTemplate/skinny-tiddlywiki5.html.tid

Mobile:

- src/services/GitService/index.ts
- src/services/GitService/useGitImport.ts
- src/services/WikiStorageService/FileSystemWikiStorageService.ts
- src/services/WikiStorageService/tiddlerFileParser.ts
- src/pages/WikiWebView/useTiddlyWiki.ts
- src/pages/WikiWebView/useStreamChunksToWebView/FileSystemTiddlersReadStream.ts
- plugins/src/expo-file-system-syncadaptor/file-system-syncadaptor.ts

Upstream TiddlyWiki reference:

- node_modules/tiddlywiki/boot/boot.js
