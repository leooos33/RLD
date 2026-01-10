
import os
import sys

# Test config without loading real env if possible, or verify loaded env
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
import config

def test_assets_dict():
    assets = config.ASSETS
    assert "USDC" in assets
    assert "DAI" in assets
    assert "USDT" in assets
    assert "SOFR" in assets
    
    assert assets["USDC"]["table"] == "rates"
    assert assets["SOFR"]["type"] == "offchain_file"

def test_contracts_defined():
    assert config.AAVE_POOL_ADDRESS.startswith("0x")
    assert config.UNI_POOL_ADDRESS.startswith("0x")

def test_db_name():
    assert config.DB_NAME == "aave_rates.db"
