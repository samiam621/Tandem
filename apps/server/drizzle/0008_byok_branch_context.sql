CREATE TABLE `session_keys` (
	`session_id` text PRIMARY KEY NOT NULL,
	`key_ciphertext` text NOT NULL,
	`key_last4` text NOT NULL,
	`set_by` text NOT NULL,
	`set_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `branches` ADD `purpose` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `branch_context` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `branch_context_updated_at` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `branch_context_updated_by` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `kind` text DEFAULT 'text' NOT NULL;
--> statement-breakpoint
ALTER TABLE `messages` ADD `ask_question` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `asked_branch_id` text;--> statement-breakpoint
ALTER TABLE `project_docs` ADD `updated_at` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_docs` ADD `updated_by` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `project_docs` SET `updated_at` = `created_at`, `updated_by` = `uploaded_by` WHERE `updated_at` = '';
