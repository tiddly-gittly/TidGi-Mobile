# TidGi Mobile

Mobile Tiddlywiki app that lazy-load local-first tid/md file, and sync with TidGi-Desktop.

## How it stores data

When sync from a TidGi-Desktop app, a HTML with all plugins and skinny-tiddlers are store in the Mobile storage. And we also sync all tid/md file from your Desktop App to the Mobile storage.

Later, we use a Sync-Adaptor to only load the file you need lazily, to increase performance on huge wiki.

Currently only non-system tiddlers are synced back to TidGi-Desktop (Because system tiddlers like Plugins, are stored in the HTML, which is hard to sync). If plugins are changed, a full resync from TidGi-Desktop is required.

## Permissions

1. Notification: We use notification to switch between full screen wiki and menu, also allow plugin to show notification.
