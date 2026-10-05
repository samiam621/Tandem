UPDATE branches SET model = 'qwen/qwen3.8-27b:free' WHERE model = 'meta-llama/llama-3.3-70b-instruct:free';
--> statement-breakpoint
UPDATE sessions SET default_model = 'qwen/qwen3.8-27b:free' WHERE default_model = 'meta-llama/llama-3.3-70b-instruct:free';
