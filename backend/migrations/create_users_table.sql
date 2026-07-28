-- Migration: Create users table for FastAPI authentication backend
-- Target database: Supabase PostgreSQL

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
