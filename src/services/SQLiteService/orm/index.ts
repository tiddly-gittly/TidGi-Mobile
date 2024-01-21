/* eslint-disable unicorn/prevent-abbreviations */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const TiddlersSQLModel = sqliteTable('tiddlers', {
  title: text('title').primaryKey(),
  /**
   * If has text, means this tiddler can be skinny (user side tiddlers), if is null, means full tiddler json is in `fields` and can't be skinny (system and plugin tiddlers that needs to be load at the start).
   */
  text: text('text'),
  fields: text('fields').notNull(),
});

/**
 * Use temp table to speed up update. Can't directly batch update existing rows, SQLite can only batch insert non-existing rows.
 * Don't know why but with expo-sqlite/next, can't create temp table during runtime, otherwise it will say not found (or only say can not rollback, but actually other error), if create table if not exist before insert, it will always creating a new table.
 */
export const TempTiddlersSQLModel = sqliteTable('temp_tiddlers', {
  title: text('title').primaryKey(),
  text: text('text'),
});

export const TiddlerChangeSQLModel = sqliteTable('tiddlers_changes_log', {
  id: integer('id').primaryKey(),
  title: text('title').notNull(),
  /**
   * TiddlersLogOperation
   */
  operation: text('operation').notNull(),
  timestamp: text('timestamp').notNull(),
});
