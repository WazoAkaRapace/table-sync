CREATE TABLE `gma_entity_discards` (
	`party_id` integer NOT NULL,
	`entity_id` text NOT NULL,
	`discarded_by_user_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`party_id`, `entity_id`),
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discarded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
