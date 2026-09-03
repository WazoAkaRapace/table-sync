CREATE TABLE `campaign_countdowns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`party_id` integer NOT NULL,
	`label` text NOT NULL,
	`target_day` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_countdowns_party` ON `campaign_countdowns` (`party_id`);--> statement-breakpoint
CREATE TABLE `campaign_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`party_id` integer NOT NULL,
	`day` integer NOT NULL,
	`weather` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_days_party_day_unique` ON `campaign_days` (`party_id`,`day`);--> statement-breakpoint
CREATE TABLE `campaign_state` (
	`party_id` integer PRIMARY KEY NOT NULL,
	`day` integer DEFAULT 1 NOT NULL,
	`season` text DEFAULT 'spring' NOT NULL,
	`weather` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "campaign_state_season_check" CHECK(season IN ('spring','summer','autumn','winter'))
);
--> statement-breakpoint
CREATE TABLE `dm_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`party_id` integer NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dm_notes_party` ON `dm_notes` (`party_id`);--> statement-breakpoint
CREATE TABLE `dm_quests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`party_id` integer NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'preparation' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "dm_quests_status_check" CHECK(status IN ('preparation','active','done','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_dm_quests_party` ON `dm_quests` (`party_id`);