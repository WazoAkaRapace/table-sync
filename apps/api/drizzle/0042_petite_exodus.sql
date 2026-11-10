ALTER TABLE `spells` ADD `source` text DEFAULT 'srd' NOT NULL;--> statement-breakpoint
ALTER TABLE `spells` ADD `party_id` integer REFERENCES parties(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `spells` ADD `created_by` integer REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_spells_party` ON `spells` (`party_id`);