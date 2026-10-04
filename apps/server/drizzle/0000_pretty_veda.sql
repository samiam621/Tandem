CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`owner_id` text,
	`is_main` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`fork_message_id` text,
	`head_message_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`parent_id` text,
	`author_type` text NOT NULL,
	`author_id` text NOT NULL,
	`model` text,
	`content` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_members` (
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`owner_id` text NOT NULL,
	`default_model` text NOT NULL,
	`invite_code` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`github_id` text,
	`device_id` text,
	`avatar_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_invite_code_unique` ON `sessions` (`invite_code`);