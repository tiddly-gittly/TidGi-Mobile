/** Runtime surface used by the mobile sync adaptor's boot-time syncer guard. */
declare module 'tiddlywiki' {
  interface Syncer {
    /** TiddlyWiki passes an optional source callback at runtime. */
    getSyncedTiddlers(source?: unknown): string[];
  }
}
