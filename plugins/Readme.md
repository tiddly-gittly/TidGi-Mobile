# Tiddlywiki plugins

Plugins that only used in TidGi-Mobile, and will be dynamically injected into wiki, won't be saved to wiki file/folder.

## FAQ

### plugin-priority

Seems adding this field blocks plugin to be properly parsed, will cause wiki stuck on loading page.

And it works without this field, because tiddly-web plugin is not sync to mobile when downloading HTML, so it is fine without this field.

### `window.service.wikiStorageService.methodName is not a function`

Don't forget to register method in WikiStorageServiceIPCDescriptor.
