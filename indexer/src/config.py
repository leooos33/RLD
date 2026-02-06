# RLD Indexer Configuration
from dataclasses import dataclass, field
from typing import Optional
import os

@dataclass
class DatabaseConfig:
    """PostgreSQL connection configuration"""
    host: str = "localhost"
    port: int = 5432
    user: str = "rld"
    password: str = ""
    database: str = "rld_indexer"
    
    @property
    def dsn(self) -> str:
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"

@dataclass
class RPCConfig:
    """Ethereum RPC configuration"""
    url: str = "http://localhost:8545"
    ws_url: Optional[str] = None
    batch_size: int = 100
    timeout_seconds: int = 30
    retry_attempts: int = 3
    retry_delay_seconds: float = 1.0

@dataclass
class ChainConfig:
    """Chain-specific configuration"""
    chain_id: int = 11155111  # Sepolia default
    finality_blocks: int = 12
    block_time_seconds: float = 12.0
    start_block: int = 0

@dataclass
class ContractAddresses:
    """Deployed contract addresses"""
    rld_core: str = ""
    broker_factory: str = ""
    pool_manager: str = ""
    posm: str = ""
    twamm: str = ""

@dataclass
class SafetyConfig:
    """Paranoid safety settings"""
    reconcile_every_n_blocks: int = 100
    full_audit_every_n_blocks: int = 1000
    invariant_check_enabled: bool = True
    dual_source_mode: bool = True
    max_state_drift_wei: int = 1_000_000  # 1 USDC allowable drift
    alert_health_factor_threshold: float = 1.2
    
@dataclass 
class IndexerConfig:
    """Main indexer configuration"""
    db: DatabaseConfig = field(default_factory=DatabaseConfig)
    rpc: RPCConfig = field(default_factory=RPCConfig)
    chain: ChainConfig = field(default_factory=ChainConfig)
    contracts: ContractAddresses = field(default_factory=ContractAddresses)
    safety: SafetyConfig = field(default_factory=SafetyConfig)
    
    # Processing settings
    poll_interval_seconds: float = 3.0
    batch_size: int = 50
    max_reorg_depth: int = 128
    
    # Feature flags
    read_only_mode: bool = True  # Start in read-only mode
    liquidation_enabled: bool = False
    
    @classmethod
    def from_env(cls) -> "IndexerConfig":
        """Load config from environment variables"""
        return cls(
            db=DatabaseConfig(
                host=os.getenv("DB_HOST", "localhost"),
                port=int(os.getenv("DB_PORT", "5432")),
                user=os.getenv("DB_USER", "rld"),
                password=os.getenv("DB_PASSWORD", ""),
                database=os.getenv("DB_NAME", "rld_indexer"),
            ),
            rpc=RPCConfig(
                url=os.getenv("RPC_URL", "http://localhost:8545"),
                ws_url=os.getenv("WS_RPC_URL"),
            ),
            chain=ChainConfig(
                chain_id=int(os.getenv("CHAIN_ID", "11155111")),
                finality_blocks=int(os.getenv("FINALITY_BLOCKS", "12")),
                start_block=int(os.getenv("START_BLOCK", "0")),
            ),
            contracts=ContractAddresses(
                rld_core=os.getenv("RLD_CORE_ADDRESS", ""),
                broker_factory=os.getenv("BROKER_FACTORY_ADDRESS", ""),
                pool_manager=os.getenv("POOL_MANAGER_ADDRESS", ""),
                posm=os.getenv("POSM_ADDRESS", ""),
                twamm=os.getenv("TWAMM_ADDRESS", ""),
            ),
            safety=SafetyConfig(
                reconcile_every_n_blocks=int(os.getenv("RECONCILE_BLOCKS", "100")),
                dual_source_mode=os.getenv("DUAL_SOURCE_MODE", "true").lower() == "true",
            ),
            read_only_mode=os.getenv("READ_ONLY_MODE", "true").lower() == "true",
            liquidation_enabled=os.getenv("LIQUIDATION_ENABLED", "false").lower() == "true",
        )
