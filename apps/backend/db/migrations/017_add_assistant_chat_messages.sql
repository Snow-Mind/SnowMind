-- Assistant chat session persistence (Gemini conversation context)
-- Stores authenticated user-scoped chat messages keyed by session id.

CREATE TABLE IF NOT EXISTS assistant_chat_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    privy_user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_messages_user_session_created
    ON assistant_chat_messages (privy_user_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_messages_created
    ON assistant_chat_messages (created_at DESC);

ALTER TABLE assistant_chat_messages ENABLE ROW LEVEL SECURITY;
