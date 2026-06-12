-- 1. Create Listings Table (Available Motorbikes)
CREATE TABLE IF NOT EXISTS listings (
    id SERIAL PRIMARY KEY,
    brand VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INT NOT NULL,
    price NUMERIC NOT NULL,
    odo INT NOT NULL,
    location VARCHAR(100) NOT NULL,
    paperwork_status VARCHAR(100) NOT NULL, -- e.g., 'clean_title', 'waiting_original_file'
    image_url VARCHAR(255)
);

-- 2. Create Conversations Table (Lead states)
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id VARCHAR(255) PRIMARY KEY,
    buyer_id VARCHAR(100) NOT NULL,
    seller_id VARCHAR(100) NOT NULL,
    lead_stage VARCHAR(50) NOT NULL DEFAULT 'DISCOVERY', -- DISCOVERY, MATCHING, NEGOTIATION, APPOINTMENT, CLOSING, DROPPED
    structured_state JSONB NOT NULL DEFAULT '{}'::jsonb, -- Extracted budget, preferences, risks, etc.
    rolling_summary TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create Conversation Events Table (Chat History & Actions)
CREATE TABLE IF NOT EXISTS conversation_events (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(255) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(50) NOT NULL, -- USER_MESSAGE, TOOL_CALL, TOOL_RESULT, STATE_UPDATE, ESCALATION, SYSTEM
    actor VARCHAR(50) NOT NULL,      -- buyer, seller, agent, system
    payload JSONB NOT NULL           -- e.g., {"text": "Hello"}, {"tool_name": "...", "args": {...}}
);

-- 4. Create Conversation Connections Table (Links Buyer, Seller and Bridge conversations)
CREATE TABLE IF NOT EXISTS conversation_connections (
    id SERIAL PRIMARY KEY,
    buyer_conv_id VARCHAR(255) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    seller_conv_id VARCHAR(255) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    bridge_id VARCHAR(255) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed Initial Listings (Mock Data for search_listings tool)
INSERT INTO listings (brand, model, year, price, odo, location, paperwork_status) VALUES
('Honda', 'Air Blade', 2021, 32000000, 19000, 'HCM', 'clean_title'),
('Honda', 'Vision', 2020, 24000000, 12000, 'HCM', 'waiting_original_file'),
('Yamaha', 'Janus', 2022, 23000000, 8000, 'HCM', 'clean_title'),
('Honda', 'Lead', 2019, 26000000, 25000, 'HN', 'clean_title'),
('Yamaha', 'Exciter', 2021, 35000000, 15000, 'HCM', 'clean_title'),
('Vespa', 'Sprint', 2022, 65000000, 5000, 'HCM', 'clean_title');

-- Database Webhook Trigger Configuration (Supabase deployment context)
-- Note: In Supabase, you can set up this Webhook using the dashboard UI.
-- Below is the SQL-equivalent config using the pg_net extension to trigger Vercel Serverless Function.

-- CREATE EXTENSION IF NOT EXISTS pg_net;
-- 
-- CREATE OR REPLACE FUNCTION trigger_vercel_agent_webhook()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   PERFORM net.http_post(
--     url := 'https://your-vercel-domain.com/api/agent/process',
--     headers := '{"Content-Type": "application/json"}'::jsonb,
--     body := json_build_object(
--       'event_id', NEW.id,
--       'conversation_id', NEW.conversation_id,
--       'actor', NEW.actor,
--       'event_type', NEW.event_type,
--       'payload', NEW.payload
--     )::text
--   );
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- 
-- CREATE TRIGGER on_message_created
-- AFTER INSERT ON conversation_events
-- FOR EACH ROW
-- WHEN (NEW.actor IN ('buyer', 'seller') AND NEW.event_type = 'USER_MESSAGE')
-- EXECUTE FUNCTION trigger_vercel_agent_webhook();
