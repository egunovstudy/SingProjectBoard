CREATE TABLE board_setting (mode VARCHAR(16) PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE remote_entity (mode VARCHAR(16) NOT NULL, kind VARCHAR(16) NOT NULL, id VARCHAR(255) NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (mode, kind, id));
CREATE TABLE entity_cache (mode VARCHAR(16) NOT NULL, kind VARCHAR(16) NOT NULL, id VARCHAR(255) NOT NULL, payload TEXT NOT NULL, missing BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY (mode, kind, id));
CREATE TABLE board_layout (mode VARCHAR(16) NOT NULL, id VARCHAR(255) NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (mode, id));
CREATE TABLE board_operation (id VARCHAR(36) PRIMARY KEY, mode VARCHAR(16) NOT NULL, entity_id VARCHAR(255), kind VARCHAR(32) NOT NULL, status VARCHAR(20) NOT NULL, payload TEXT NOT NULL, detail TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, next_attempt BIGINT NOT NULL DEFAULT 0);
CREATE INDEX operation_queue ON board_operation(mode, status, created_at);
