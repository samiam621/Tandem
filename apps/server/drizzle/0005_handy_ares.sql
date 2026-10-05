CREATE TABLE `session_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_documents_session_name` ON `session_documents` (`session_id`,`name`);--> statement-breakpoint
ALTER TABLE `branches` ADD `document_ids` text;