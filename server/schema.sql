-- ==============================================================================
-- PRINTED LICENSE SEARCH MANAGEMENT SYSTEM (PLSMS) - SMART CARDS SCHEMA & VIEWS
-- Business Logic:
-- 1. Core Identity: Total Cards = Not-Distributed + Distributed
-- 2. Missing cards are a sub-status of DISTRIBUTED (issue_flag = 'MISSING')
-- 3. Time-Bound Rule: Operator can only change issue_flag to 'MISSING' on the same day
--    of distribution (DATE(distributed_at) == CURRENT_DATE).
-- ==============================================================================

-- 1. SMART CARDS TABLE
CREATE TABLE IF NOT EXISTS smart_cards (
    applicant_id VARCHAR(64) PRIMARY KEY,
    license_number VARCHAR(64) UNIQUE NOT NULL,
    holder_name VARCHAR(255) NOT NULL,
    main_status VARCHAR(32) NOT NULL DEFAULT 'NOT_DISTRIBUTED' CHECK (main_status IN ('DISTRIBUTED', 'NOT_DISTRIBUTED')),
    issue_flag VARCHAR(32) NOT NULL DEFAULT 'NORMAL' CHECK (issue_flag IN ('NORMAL', 'MISSING')),
    status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
    office VARCHAR(128) NOT NULL,
    category VARCHAR(32) DEFAULT 'K',
    father_or_spouse_name VARCHAR(255) NULL,
    phone VARCHAR(32) NULL,
    nid_or_passport VARCHAR(64) NULL,
    smart_card_serial VARCHAR(64) NULL,
    
    -- Distribution tracking
    distributed_at TIMESTAMP NULL,
    distributed_date_bs VARCHAR(32) NULL,
    distributed_by VARCHAR(128) NULL,
    receiver_name VARCHAR(255) NULL,
    receiver_phone VARCHAR(32) NULL,
    receiver_nid VARCHAR(64) NULL,
    receiver_relation VARCHAR(64) NULL,
    submitted_document VARCHAR(128) NULL,
    recommending_staff_name VARCHAR(128) NULL,
    handover_reference VARCHAR(64) NULL,
    receiver_remarks TEXT NULL,

    -- Missing incident tracking
    missing_reason TEXT NULL,
    missing_reported_at TIMESTAMP NULL,
    missing_date_bs VARCHAR(32) NULL,
    missing_reported_by VARCHAR(128) NULL,
    
    -- Metadata
    import_id VARCHAR(64) NULL,
    lot_code VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for high speed lookups
CREATE INDEX IF NOT EXISTS idx_smart_cards_license ON smart_cards(license_number);
CREATE INDEX IF NOT EXISTS idx_smart_cards_status ON smart_cards(main_status, issue_flag);
CREATE INDEX IF NOT EXISTS idx_smart_cards_distributed_at ON smart_cards(distributed_at);

-- ==============================================================================
-- 2. SQL VIEWS
-- ==============================================================================

-- VIEW 1: Distributed Cards (All distributed cards with same-day time-bound evaluation)
CREATE OR REPLACE VIEW vw_distributed_cards AS
SELECT 
    applicant_id,
    license_number,
    holder_name,
    main_status,
    issue_flag,
    status,
    office,
    category,
    distributed_at,
    distributed_date_bs,
    distributed_by,
    receiver_name,
    receiver_phone,
    receiver_relation,
    submitted_document,
    -- Time-Bound Action Rule:
    -- Evaluates whether the card was distributed today (1 = allowed, 0 = locked/disabled)
    CASE 
        WHEN distributed_at IS NOT NULL AND CAST(distributed_at AS DATE) = CURRENT_DATE THEN 1 
        ELSE 0 
    END AS can_report_missing
FROM smart_cards
WHERE main_status = 'DISTRIBUTED' OR status IN ('DISTRIBUTED', 'MISSING', 'FOUND');

-- VIEW 2: Missing Cards View (Sub-status where issue_flag = 'MISSING')
CREATE OR REPLACE VIEW vw_missing_cards AS
SELECT 
    applicant_id,
    license_number,
    holder_name,
    main_status,
    issue_flag,
    status,
    office,
    category,
    receiver_phone,
    missing_reason,
    missing_reported_at,
    missing_date_bs,
    missing_reported_by,
    distributed_at,
    distributed_date_bs
FROM smart_cards
WHERE (main_status = 'DISTRIBUTED' AND issue_flag = 'MISSING') OR status = 'MISSING';

-- VIEW 3: Not Distributed Cards View
CREATE OR REPLACE VIEW vw_not_distributed_cards AS
SELECT 
    applicant_id,
    license_number,
    holder_name,
    main_status,
    issue_flag,
    status,
    office,
    category,
    created_at
FROM smart_cards
WHERE main_status = 'NOT_DISTRIBUTED' AND status NOT IN ('DISTRIBUTED', 'MISSING', 'FOUND');

-- VIEW 4: Total Inventory Reconciliation (Identity: Total = Not-Distributed + Distributed)
CREATE OR REPLACE VIEW vw_inventory_identity_summary AS
SELECT
    COUNT(*) AS total_cards,
    COUNT(CASE WHEN main_status = 'NOT_DISTRIBUTED' AND status NOT IN ('DISTRIBUTED', 'MISSING', 'FOUND') THEN 1 END) AS not_distributed_cards,
    COUNT(CASE WHEN main_status = 'DISTRIBUTED' OR status IN ('DISTRIBUTED', 'MISSING', 'FOUND') THEN 1 END) AS distributed_cards,
    COUNT(CASE WHEN issue_flag = 'MISSING' OR status = 'MISSING' THEN 1 END) AS missing_sub_status_cards
FROM smart_cards;
