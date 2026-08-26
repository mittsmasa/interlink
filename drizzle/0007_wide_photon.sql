-- 既存の重複ペアを 1 本に落としてから unique index を張る。
-- 残すのは各ペアで最も古い 1 本（created_at 昇順、同値なら rowid 昇順で決定的に選ぶ）。
DELETE FROM `edges` WHERE `rowid` NOT IN (
	SELECT `rowid` FROM (
		SELECT `rowid`, ROW_NUMBER() OVER (
			PARTITION BY `project_id`, `source_node_id`, `target_node_id`
			ORDER BY `created_at` ASC, `rowid` ASC
		) AS `rn` FROM `edges`
	) WHERE `rn` = 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `edges_project_pair_unq` ON `edges` (`project_id`,`source_node_id`,`target_node_id`);
