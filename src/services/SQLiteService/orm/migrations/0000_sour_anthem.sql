CREATE TABLE `temp_tiddlers` (
	`title` text PRIMARY KEY NOT NULL,
	`text` text
);
--> statement-breakpoint
CREATE TABLE `tiddlers_changes_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`operation` text NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tiddlers` (
	`title` text PRIMARY KEY NOT NULL,
	`text` text,
	`fields` text NOT NULL
);
