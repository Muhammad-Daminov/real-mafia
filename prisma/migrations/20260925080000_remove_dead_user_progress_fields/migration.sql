-- Remove dead progression fields from "User".
--
-- `level`, `xp`, `gamesPlayed` and `gamesWon` were never written by any code
-- path (verified: the only references were a read-only projection in
-- users.service.ts) and all rows held their defaults.
--
-- `gamesPlayed`/`gamesWon` are superseded by Master TZ §36's `user_stats`
-- model (`games_completed_total`, `wins_by_team`), which is derived and
-- rebuildable from `game_results`, never authoritative on the user row.
-- `level`/`xp` correspond to no concept in the specification at all.
--
-- DESTRUCTIVE: these columns are dropped, not migrated. Accepted deliberately
-- while the table holds a single real row and the data is all-defaults.
-- See docs/audit/GAP_REPORT.md F-05.

ALTER TABLE "User" DROP COLUMN "level";
ALTER TABLE "User" DROP COLUMN "xp";
ALTER TABLE "User" DROP COLUMN "gamesPlayed";
ALTER TABLE "User" DROP COLUMN "gamesWon";
