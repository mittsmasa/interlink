CREATE TABLE `diagram_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`summary` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diagram_revisions_project_id_idx` ON `diagram_revisions` (`project_id`);