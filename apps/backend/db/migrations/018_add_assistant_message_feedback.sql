-- Assistant response quality feedback persistence.
-- Stores thumbs up/down signals for one assistant response within a user session.

CREATE TABLE IF NOT EXISTS assistant_message_feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    privy_user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    assistant_created_at TIMESTAMPTZ NOT NULL,
    feedback_value TEXT NOT NULL CHECK (feedback_value IN ('up', 'down')),
    message_excerpt TEXT NOT NULL CHECK (length(trim(message_excerpt)) > 0),
    note TEXT NULL CHECK (note IS NULL OR length(note) <= 600),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (privy_user_id, session_id, assistant_created_at)
);

CREATE INDEX IF NOT EXISTS idx_assistant_message_feedback_user_created
    ON assistant_message_feedback (privy_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_message_feedback_session_created
    ON assistant_message_feedback (privy_user_id, session_id, created_at DESC);

ALTER TABLE assistant_message_feedback ENABLE ROW LEVEL SECURITY;
