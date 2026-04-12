/**
 * Augment tw5-typed Syncer with runtime properties that exist on the
 * prototype but aren't yet declared in tw5-typed.
 *
 * TODO: contribute these upstream to https://github.com/tiddly-gittly/TW5-Typed
 */
declare module 'tiddlywiki' {
  interface Syncer {
    /** Minimum interval (ms) between consecutive saves of the same tiddler. Default 1000. */
    throttleInterval: number;
    /** Interval (ms) for the task dispatch timer. Default 250. */
    taskTimerInterval: number;
  }
}
