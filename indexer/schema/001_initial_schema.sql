-- RLD Indexer Database Schema
-- Version: 1.0
-- PostgreSQL 15+

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Block tracking with reorg support
CREATE TABLE blocks (
    block_number BIGINT PRIMARY KEY,
    block_hash TEXT UNIQUE NOT NULL,
    parent_hash TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    indexed_at TIMESTAMPTZ DEFAULT NOW(),
    reorged BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_blocks_hash ON blocks(block_hash);
CREATE INDEX idx_blocks_reorged ON blocks(reorged) WHERE reorged = TRUE;

-- Market registry
CREATE TABLE markets (
    market_id TEXT PRIMARY KEY,
    collateral_token TEXT NOT NULL,
    underlying_token TEXT NOT NULL,
    underlying_pool TEXT NOT NULL,
    position_token TEXT,
    rate_oracle TEXT,
    spot_oracle TEXT,
    funding_model TEXT,
    liquidation_module TEXT,
    curator TEXT,
    created_at_block BIGINT REFERENCES blocks(block_number),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Broker registry
CREATE TABLE brokers (
    broker_address TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    market_id TEXT NOT NULL REFERENCES markets(market_id),
    collateral_token TEXT,
    position_token TEXT,
    created_at_block BIGINT REFERENCES blocks(block_number),
    status TEXT DEFAULT 'active',
    discovered_via TEXT,  -- 'event' or 'scan'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_brokers_owner ON brokers(owner_address);
CREATE INDEX idx_brokers_market ON brokers(market_id);
CREATE INDEX idx_brokers_status ON brokers(status);

-- Account registry (wallets)
CREATE TABLE accounts (
    address TEXT PRIMARY KEY,
    first_seen_block BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SNAPSHOT TABLES (Per-Block State)
-- ============================================================================

-- Per-block market state
CREATE TABLE market_snapshots (
    market_id TEXT NOT NULL REFERENCES markets(market_id),
    block_number BIGINT NOT NULL REFERENCES blocks(block_number),
    
    -- Funding
    normalization_factor NUMERIC(38, 18) NOT NULL,
    funding_rate NUMERIC(38, 18),
    last_funding_timestamp BIGINT,
    
    -- Prices
    mark_price NUMERIC(38, 18),
    index_price NUMERIC(38, 18),
    spot_price NUMERIC(38, 18),
    
    -- Debt
    total_debt NUMERIC(38, 0),
    debt_cap NUMERIC(38, 0),
    
    -- Pool state
    sqrt_price_x96 NUMERIC(60, 0),
    tick INT,
    liquidity NUMERIC(38, 0),
    
    -- TWAMM
    twamm_sell_rate_0_for_1 NUMERIC(38, 18),
    twamm_sell_rate_1_for_0 NUMERIC(38, 18),
    
    -- Fees
    lp_fee NUMERIC(38, 18),
    protocol_fee NUMERIC(38, 18),
    
    -- Metadata
    is_filled_forward BOOLEAN DEFAULT FALSE,
    
    PRIMARY KEY (market_id, block_number)
);

CREATE INDEX idx_market_snapshots_block ON market_snapshots(block_number);

-- Per-block broker state
CREATE TABLE broker_snapshots (
    broker_address TEXT NOT NULL REFERENCES brokers(broker_address),
    block_number BIGINT NOT NULL REFERENCES blocks(block_number),
    
    -- Balances
    collateral_balance NUMERIC(38, 0),
    position_balance NUMERIC(38, 0),
    
    -- Debt
    debt_principal NUMERIC(38, 0),
    debt_value NUMERIC(38, 18),
    
    -- Health
    net_account_value NUMERIC(38, 18),
    health_factor NUMERIC(38, 18),
    liquidation_price NUMERIC(38, 18),
    is_solvent BOOLEAN,
    
    -- TWAMM
    twamm_order_id TEXT,
    twamm_sell_owed NUMERIC(38, 0),
    twamm_buy_owed NUMERIC(38, 0),
    
    -- V4 LP
    v4_token_id BIGINT,
    v4_liquidity NUMERIC(38, 0),
    v4_value NUMERIC(38, 18),
    
    -- Metadata
    is_filled_forward BOOLEAN DEFAULT FALSE,
    
    PRIMARY KEY (broker_address, block_number)
);

CREATE INDEX idx_broker_snapshots_block ON broker_snapshots(block_number);
CREATE INDEX idx_broker_snapshots_solvent ON broker_snapshots(is_solvent, block_number) 
    WHERE is_solvent = FALSE;

-- ============================================================================
-- EVENT TABLES
-- ============================================================================

-- Raw immutable event log (append-only)
CREATE TABLE raw_events (
    id BIGSERIAL PRIMARY KEY,
    block_number BIGINT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INT NOT NULL,
    tx_index INT,
    contract_address TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_signature TEXT,
    event_data BYTEA,
    decoded_data JSONB,
    ref TEXT,  -- Idempotency key: keccak256(txHash, logIndex)
    indexed_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (tx_hash, log_index)
);

CREATE INDEX idx_raw_events_block ON raw_events(block_number);
CREATE INDEX idx_raw_events_contract ON raw_events(contract_address);
CREATE INDEX idx_raw_events_name ON raw_events(event_name);
CREATE INDEX idx_raw_events_ref ON raw_events(ref);

-- Funding updates (from FundingApplied events)
CREATE TABLE funding_updates (
    id SERIAL PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES markets(market_id),
    block_number BIGINT NOT NULL REFERENCES blocks(block_number),
    tx_hash TEXT NOT NULL,
    old_norm_factor NUMERIC(38, 18) NOT NULL,
    new_norm_factor NUMERIC(38, 18) NOT NULL,
    funding_rate NUMERIC(38, 18),
    time_delta INT,
    indexed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_funding_updates_market ON funding_updates(market_id, block_number);

-- Fee collection tracking
CREATE TABLE fees (
    id SERIAL PRIMARY KEY,
    market_id TEXT REFERENCES markets(market_id),
    block_number BIGINT NOT NULL REFERENCES blocks(block_number),
    tx_hash TEXT NOT NULL,
    token TEXT NOT NULL,
    amount NUMERIC(38, 0) NOT NULL,
    fee_type TEXT NOT NULL,  -- 'lp', 'protocol', 'twamm'
    payer TEXT,
    recipient TEXT,
    indexed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fees_market ON fees(market_id, block_number);
CREATE INDEX idx_fees_type ON fees(fee_type);

-- Price history
CREATE TABLE prices (
    market_id TEXT NOT NULL REFERENCES markets(market_id),
    block_number BIGINT NOT NULL REFERENCES blocks(block_number),
    mark_price NUMERIC(38, 18),
    index_price NUMERIC(38, 18),
    spot_price NUMERIC(38, 18),
    funding_rate NUMERIC(38, 18),
    indexed_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (market_id, block_number)
);

-- Position changes (from PositionModified events)
CREATE TABLE position_changes (
    id SERIAL PRIMARY KEY,
    market_id TEXT NOT NULL REFERENCES markets(market_id),
    broker_address TEXT NOT NULL REFERENCES brokers(broker_address),
    block_number BIGINT NOT NULL REFERENCES blocks(block_number),
    tx_hash TEXT NOT NULL,
    delta_collateral NUMERIC(38, 0),
    delta_debt NUMERIC(38, 0),
    new_debt_principal NUMERIC(38, 0),
    indexed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_position_changes_broker ON position_changes(broker_address, block_number);

-- ============================================================================
-- SAFETY TABLES
-- ============================================================================

-- Reconciliation tracking
CREATE TABLE reconciliation_status (
    id SERIAL PRIMARY KEY,
    block_number BIGINT NOT NULL,
    entity_type TEXT NOT NULL,  -- 'broker', 'market'
    entity_id TEXT NOT NULL,
    primary_hash TEXT,
    secondary_hash TEXT,
    matches BOOLEAN NOT NULL,
    drift_fields JSONB,
    action TEXT,  -- 'none', 'rebuild', 'alert'
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reconcile_drift ON reconciliation_status(matches, block_number) 
    WHERE matches = FALSE;

-- Finalized snapshots (reorg-safe)
CREATE TABLE finalized_snapshots (
    entity_type TEXT NOT NULL,  -- 'broker', 'market'
    entity_id TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    state JSONB NOT NULL,
    confirmations INT,
    is_finalized BOOLEAN DEFAULT FALSE,
    finalized_at TIMESTAMPTZ,
    
    PRIMARY KEY (entity_type, entity_id, block_number)
);

CREATE INDEX idx_finalized_block ON finalized_snapshots(block_number, is_finalized);

-- Liquidation candidates
CREATE TABLE liquidation_candidates (
    broker_address TEXT NOT NULL REFERENCES brokers(broker_address),
    market_id TEXT NOT NULL REFERENCES markets(market_id),
    block_number BIGINT NOT NULL,
    health_factor NUMERIC(38, 18),
    debt_value NUMERIC(38, 18),
    shortfall NUMERIC(38, 18),
    priority_score INT,
    status TEXT DEFAULT 'pending',  -- 'pending', 'executed', 'recovered', 'failed'
    executed_tx TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (broker_address, market_id)
);

CREATE INDEX idx_liquidation_status ON liquidation_candidates(status, priority_score DESC);

-- Invariant check results
CREATE TABLE invariant_checks (
    block_number BIGINT PRIMARY KEY,
    wrlp_supply_matches_debt BOOLEAN,
    all_markets_consistent BOOLEAN,
    nf_monotonic BOOLEAN,
    all_balances_positive BOOLEAN,
    all_passed BOOLEAN NOT NULL,
    failure_details JSONB,
    checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invariant_failures ON invariant_checks(all_passed) 
    WHERE all_passed = FALSE;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Latest broker state (most recent snapshot)
CREATE VIEW broker_latest_state AS
SELECT DISTINCT ON (broker_address)
    bs.*,
    b.owner_address,
    b.market_id
FROM broker_snapshots bs
JOIN brokers b ON b.broker_address = bs.broker_address
ORDER BY broker_address, block_number DESC;

-- At-risk brokers (health factor < 1.2)
CREATE VIEW at_risk_brokers AS
SELECT * FROM broker_latest_state
WHERE health_factor < 1.2e18 AND health_factor > 0;

-- Latest market state
CREATE VIEW market_latest_state AS
SELECT DISTINCT ON (market_id) *
FROM market_snapshots
ORDER BY market_id, block_number DESC;

-- Account full state (wallet + brokers)
CREATE VIEW account_full_state AS
SELECT 
    a.address,
    b.broker_address,
    bls.collateral_balance,
    bls.position_balance,
    bls.debt_principal,
    bls.debt_value,
    bls.net_account_value,
    bls.health_factor,
    bls.is_solvent
FROM accounts a
LEFT JOIN brokers b ON b.owner_address = a.address
LEFT JOIN broker_latest_state bls ON bls.broker_address = b.broker_address;

-- ============================================================================
-- GRANTS (for application user)
-- ============================================================================

-- Revoke dangerous operations on raw_events (append-only)
-- REVOKE UPDATE, DELETE ON raw_events FROM app_user;
