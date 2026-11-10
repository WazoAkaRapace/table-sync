ALTER TABLE `monsters` ADD `origin` text DEFAULT 'srd' NOT NULL;--> statement-breakpoint
ALTER TABLE `monsters` ADD `party_id` integer REFERENCES parties(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `monsters` ADD `created_by` integer REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_monsters_party` ON `monsters` (`party_id`);
