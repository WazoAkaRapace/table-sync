CREATE TABLE `gma_moments` (
	`party_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`moment_id` text NOT NULL,
	`is_quote` integer DEFAULT 0 NOT NULL,
	`type` text,
	`description` text NOT NULL,
	`speaker` text,
	`context` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`party_id`, `session_id`, `moment_id`),
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_gma_moments_session` ON `gma_moments` (`party_id`,`session_id`);