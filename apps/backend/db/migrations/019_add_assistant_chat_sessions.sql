-- Assistant session metadata for persistent title overrides.
CREATE TABLE IF NOT EXISTS assistant_chat_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    privy_user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (privy_user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_sessions_user_updated
    ON assistant_chat_sessions (privy_user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION set_assistant_chat_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assistant_chat_sessions_updated_at ON assistant_chat_sessions;
CREATE TRIGGER trg_assistant_chat_sessions_updated_at
BEFORE UPDATE ON assistant_chat_sessions
FOR EACH ROW
EXECUTE FUNCTION set_assistant_chat_sessions_updated_at();
