CREATE TABLE `temp_tiddlers` (
	`title` text PRIMARY KEY NOT NULL,
	`text` text
);
--> statement-breakpoint
CREATE TABLE `tiddlers_changes_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`operation` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tiddlers` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`text` text,
	`fields` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tiddlers_title_unique` ON `tiddlers` (`title`);