CREATE TABLE `gma_entities` (
	`party_id` integer NOT NULL,
	`entity_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`party_id`, `entity_id`),
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gma_entity_sessions` (
	`party_id` integer NOT NULL,
	`entity_id` text NOT NULL,
	`session_id` text NOT NULL,
	PRIMARY KEY(`party_id`, `entity_id`, `session_id`),
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gma_npc_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`party_id` integer NOT NULL,
	`npc_id` integer NOT NULL,
	`gma_entity_id` text NOT NULL,
	`linked_by_user_id` integer NOT NULL,
	`description_hash` text,
	`last_pull_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`npc_id`) REFERENCES `npcs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gma_npc_links_entity_unique` ON `gma_npc_links` (`gma_entity_id`);--> statement-breakpoint
CREATE INDEX `idx_gma_npc_links_party` ON `gma_npc_links` (`party_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gma_npc_links_party_npc_unique` ON `gma_npc_links` (`party_id`,`npc_id`);--> statement-breakpoint
ALTER TABLE `party_gma_links` ADD `entities_fetched_at` text;