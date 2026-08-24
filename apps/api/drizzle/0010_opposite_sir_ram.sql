CREATE TABLE `gma_pc_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`party_id` integer NOT NULL,
	`character_id` integer,
	`gma_pc_id` text NOT NULL,
	`name_at_sync` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gma_pc_links_pc_unique` ON `gma_pc_links` (`gma_pc_id`);--> statement-breakpoint
CREATE INDEX `idx_gma_pc_links_party` ON `gma_pc_links` (`party_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gma_pc_links_party_character_unique` ON `gma_pc_links` (`party_id`,`character_id`);--> statement-breakpoint
CREATE TABLE `gma_recaps` (
	`party_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`style` text NOT NULL,
	`text` text NOT NULL,
	`updated_at` text,
	PRIMARY KEY(`party_id`, `session_id`, `style`),
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gma_sessions` (
	`party_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`played_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`recaps_fetched_at` text,
	PRIMARY KEY(`party_id`, `session_id`),
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `party_gma_links` (
	`party_id` integer PRIMARY KEY NOT NULL,
	`gma_campaign_id` text NOT NULL,
	`campaign_title` text NOT NULL,
	`linked_by_user_id` integer NOT NULL,
	`sessions_fetched_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `party_gma_links_campaign_unique` ON `party_gma_links` (`gma_campaign_id`);--> statement-breakpoint
CREATE INDEX `idx_party_gma_links_campaign` ON `party_gma_links` (`gma_campaign_id`);--> statement-breakpoint
CREATE TABLE `user_gma_links` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`api_key_enc` text NOT NULL,
	`gma_account_id` text,
	`gma_email` text,
	`scope` text,
	`validated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
