# TiddlyWiki Mobile HTML Build Process

This document describes how the TiddlyWiki HTML file used in TidGi-Mobile is built and what it contains.

## Overview

TidGi-Mobile uses a pre-built TiddlyWiki HTML file as its boot kernel. This file is generated using TiddlyWiki's own rendering engine and includes all system tiddlers, core code, and themes required to start the wiki. Only user tiddlers and syncadaptor plugins are streamed in at runtime.

## Build Steps

1. The build script is located at `scripts/buildTiddlyWikiAssets.mjs`.
2. The script uses the TiddlyWiki npm package as a library. It boots the `empty` edition, which includes `$:/core` and the default themes.
3. The script renders the `$:/core/save/empty` tiddler using TiddlyWiki's rendering engine. This produces a complete HTML file with:
   - Boot kernel (boot.js, bootprefix.js, boot.css)
   - System tiddlers (core, themes) embedded in the store area as JSON
   - All required library modules
4. The output is written to `assets/tiddlywiki/tiddlywiki-empty.html`.
5. A `version.json` file is also generated for debugging purposes.

## Runtime Usage

- At runtime, the full HTML document is injected into the WebView, including the `<head>` section and meta tags.
- The HTML already contains all system tiddlers and themes in its store area.
- Only syncadaptor plugins and user tiddlers are streamed in after the HTML is loaded.
- The WebView manually activates the boot scripts after injecting the HTML and tiddler store.

## Notes

- The build process does not depend on any local TiddlyWiki repository; it uses the npm package directly.
- No separate core plugin JSON or skinny HTML is needed. Everything required for boot is included in the single HTML file.
- The HTML file is updated whenever the TiddlyWiki npm package is updated or the build script is run.
