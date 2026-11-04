CREATE TABLE `prism_login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prism_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`edition_id` text,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prism_editions` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`title` text NOT NULL,
	`label` text NOT NULL,
	`language` text DEFAULT 'ko' NOT NULL,
	`is_demo` integer DEFAULT 0 NOT NULL,
	`sample_notice` text,
	`sections` text,
	`current_version` text,
	`pending_version` text,
	`published` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prism_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`epoch` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prism_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prism_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_id` text NOT NULL,
	`object_key` text,
	`source_path` text,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`page_count` integer NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text
);
