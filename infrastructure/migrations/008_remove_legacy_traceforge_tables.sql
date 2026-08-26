DROP TRIGGER IF EXISTS traceforge_mirror_public_activity ON _traceforge;
DROP FUNCTION IF EXISTS mirror_public_traceforge_activity();
DROP TRIGGER IF EXISTS opencode_activities_mirror_traceforge ON opencode_activities;
DROP FUNCTION IF EXISTS mirror_traceforge_activity();
DROP TABLE IF EXISTS public._traceforge;
DROP TABLE IF EXISTS _traceforge;
