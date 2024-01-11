/**
 * -[is[binary]]: binary tiddlers are loaded later as file. This filter is used to get text that will be saved into SQLite.
 * // TODO: remove until https://github.com/Jermolene/TiddlyWiki5/pull/7927 merged
 * -[type[application/msword]]: seems they are not recognized as binary tiddlers properly, not sure, remove if I'm wrong...
 */
export const defaultNonBinaryFilter = ' -[is[binary]] -[type[application/msword]] -[type[application/excel]] -[type[application/mspowerpoint]] -[type[application/vnd.ms-excel]]';
/**
 * Filter all user's binary files.
 * I tested, this won't include system tiddlers. (or maybe system tiddlers currently don't have binary file?)
 */
export const defaultBinaryFilter = defaultNonBinaryFilter.replaceAll(' -', '');
/**
 * [!is[system]]: user tiddlers
 * -[type[application/javascript]]: javascript tiddlers must be preload, so is already being synced by `/tw-mobile-sync/get-skinny-tiddlywiki-tiddler-store-script`
 */
export const defaultNonPreloadedTiddlerFilter = '[!is[system]] -[type[application/javascript]]';
export const defaultTextBasedTiddlerFilter = `${defaultNonPreloadedTiddlerFilter}${defaultNonBinaryFilter}`;
