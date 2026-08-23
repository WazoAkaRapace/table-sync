ALTER TABLE `items` ADD `derived_from_item_id` integer REFERENCES items(id) ON DELETE SET NULL;
