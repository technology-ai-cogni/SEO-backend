-- Migration: Create users table for FastAPI authentication backend
-- Target database: Supabase PostgreSQL

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'INTERNAL_ASSOCIATE',
    category TEXT NOT NULL DEFAULT 'Internal',
    status TEXT NOT NULL DEFAULT 'Active',
    section_access TEXT NOT NULL DEFAULT 'Default',
    permissions TEXT NOT NULL DEFAULT 'Default',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alter table statements to guarantee dedicated columns exist for existing tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'INTERNAL_ASSOCIATE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Internal';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS section_access TEXT NOT NULL DEFAULT 'Default';
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT NOT NULL DEFAULT 'Default';

-- Case-insensitive index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
