-- Migrate any stored paid model IDs to the default free model.
-- Branches and sessions created before the :free-only requirement
-- may store IDs like "openai/gpt-4o-mini". This rewrites them so the
-- server won't reject AI reply requests for those rows.
UPDATE branches SET model = 'meta-llama/llama-3.3-70b-instruct:free' WHERE model NOT LIKE '%:free';
--> statement-breakpoint
UPDATE sessions SET default_model = 'meta-llama/llama-3.3-70b-instruct:free' WHERE default_model NOT LIKE '%:free';
