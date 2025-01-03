/**
 * -[is[binary]]: binary tiddlers are loaded later as file. This filter is used to get text that will be saved into SQLite.
 */
export const defaultNonBinaryFilter = ' -[is[binary]]';
/**
 * Filter all user's binary files.
 * I tested, this won't include system tiddlers. (or maybe system tiddlers currently don't have binary file?)
 */
export const defaultBinaryFilter = defaultNonBinaryFilter.replaceAll(' -', '');
/**
 * [!prefix[$:/core]]: user tiddlers and updated plugins and configs for plugins, like TidMe's `$:/Deck/`
 * -[type[application/javascript]]: javascript tiddlers must be preload, so is already being synced by `/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script`
 */
export const defaultNonPreloadedTiddlerFilter = '[!prefix[$:/core]] -[type[application/javascript]]';
export const defaultTextBasedTiddlerFilter = `${defaultNonPreloadedTiddlerFilter}${defaultNonBinaryFilter}`;
