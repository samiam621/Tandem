ALTER TABLE `sessions` ADD `brief` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `brief_updated_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `brief_updated_by` text;