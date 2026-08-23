-- Legacy DBs were born with UNIQUE(character_id, item_id) (pre-storage-locations
-- baseline) and never rebuilt it: the baseline snapshot already pins the
-- location-aware unique, so drizzle-kit sees no diff and cannot generate this.
-- Without it, the 3-column upsert conflict target in routes/inventory.ts fails
-- with "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint".
CREATE TABLE `__new_inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`character_id` integer NOT NULL REFERENCES characters(id) ON DELETE cascade,
	`item_id` integer NOT NULL REFERENCES items(id) ON DELETE cascade,
	`quantity` integer DEFAULT 1 NOT NULL,
	`equipped` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`storage_location_id` integer REFERENCES storage_locations(id) ON DELETE set null,
	`added_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `inventory_quantity_check` CHECK (quantity >= 0),
	CONSTRAINT `inventory_character_item_location_unique` UNIQUE(character_id, item_id, storage_location_id)
);
--> statement-breakpoint
INSERT INTO `__new_inventory`(`id`, `character_id`, `item_id`, `quantity`, `equipped`, `notes`, `storage_location_id`, `added_at`) SELECT `id`, `character_id`, `item_id`, `quantity`, `equipped`, `notes`, `storage_location_id`, `added_at` FROM `inventory`;
--> statement-breakpoint
DROP TABLE `inventory`;
--> statement-breakpoint
ALTER TABLE `__new_inventory` RENAME TO `inventory`;
--> statement-breakpoint
CREATE INDEX `idx_inventory_character` ON `inventory` (`character_id`);
--> statement-breakpoint
CREATE INDEX `idx_inventory_location` ON `inventory` (`storage_location_id`);
