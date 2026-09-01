CREATE TABLE `email_verification_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`locale` text DEFAULT 'fr' NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_verification_tokens_hash_unique` ON `email_verification_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_email_verification_tokens_user` ON `email_verification_tokens` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `pending_email` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_pending_email_unique` ON `users` (`pending_email`);