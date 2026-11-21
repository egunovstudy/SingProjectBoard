CREATE TABLE board_task_link (
    mode VARCHAR(16) NOT NULL,
    source_id VARCHAR(255) NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    PRIMARY KEY (mode, source_id, target_id),
    CHECK (source_id <> target_id)
);
