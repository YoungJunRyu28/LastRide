-- Cache rows written before cache keys were hashed used raw keys (coordinates,
-- address queries) with up to 30-day expiry. They are unreachable under the
-- hashed keys, so clear the disposable cache rather than wait for expiry.
DELETE FROM "kv_cache";
