-- Hand written: extensions the engine's indexes need (spec 0004). Runs as the owner role.
-- btree_gin lets one GIN index lead with workspace_id and attribute_id before
-- the trigram expression, so contains searches stay inside one attribute.
create extension if not exists btree_gin;
