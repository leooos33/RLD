from web3 import Web3
from eth_account import Account
import json
import os
import time

# Configuration
RPC_URL = "http://127.0.0.1:8545"
PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" # Anvil #0

w3 = Web3(Web3.HTTPProvider(RPC_URL))
account = Account.from_key(PRIVATE_KEY)

def load_abi(name):
    path = f"../contracts/out/{name}.sol/{name}.json"
    with open(path) as f:
        data = json.load(f)
        return data["abi"], data["bytecode"]["object"]

def deploy(name, args=[], abi=None, bytecode=None):
    if abi is None:
        abi, bytecode = load_abi(name)
    
    Contract = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx = Contract.constructor(*args).build_transaction({
        'from': account.address,
        'nonce': w3.eth.get_transaction_count(account.address),
        'gas': 5000000,
        'maxFeePerGas': w3.to_wei('2', 'gwei'),
        'maxPriorityFeePerGas': w3.to_wei('1', 'gwei'),
    })
    
    signed = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    print(f"✅ Deployed {name}: {receipt.contractAddress}")
    return receipt.contractAddress

def main():
    print(f"🚀 Initializing Local Anvil Chain from {account.address}...")

    # 1. Deploy Mocks for Dependencies
    # We use a generic 'MockERC20' bytecode for simple address placeholders if needed, 
    # but some need specific interfaces. For verified deployment, we should deploy the REAL implementations if possible,
    # or minimal mocks.
    # To save time, we will deploy the REAL PositionToken, PrimeBroker, etc. if we can find them.
    # Otherwise we deploy a simple "MockContract" for external deps like PoolManager.
    
    # Generic Mock for PoolManager, Oracle, FundingModel
    # We'll use a simple contract that returns 0 for everything or just exists.
    # Actually, RLDMarketFactory might make calls in constructor?
    # No, it just stores the addresses.
    
    # Let's use a simple "Empty Contract" for mocks
    # Bytecode for "contract Mock {}"
    MOCK_BYTECODE = "0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220fb0e83363076133742421337424213374242133742421337424213374242133764736f6c634300081a0033"
    MOCK_ABI = []
    
    # Deploy Mocks / Placeholders
    # usage: deploy(name, abi, bytecode)
    
    # PoolManager (Must be non-zero)
    pool_manager = deploy("MockPoolManager", abi=MOCK_ABI, bytecode=MOCK_BYTECODE)
    
    # PositionToken Impl 
    # Factory checks != 0, but uses 'new PositionToken' bytecode internally. 
    # So we can pass any non-zero address.
    pos_token_impl = deploy("MockPositionTokenImpl", abi=MOCK_ABI, bytecode=MOCK_BYTECODE)
    
    # PrimeBroker Impl
    # Factory passes this to PrimeBrokerFactory, which Clones it. 
    # We should deploy a mock/empty contract as the implementation for now.
    prime_broker_impl = deploy("MockPrimeBrokerImpl", abi=MOCK_ABI, bytecode=MOCK_BYTECODE)
    
    # Oracles
    v4_oracle = deploy("MockV4Oracle", abi=MOCK_ABI, bytecode=MOCK_BYTECODE)
    funding_model = deploy("MockFundingModel", abi=MOCK_ABI, bytecode=MOCK_BYTECODE)
    metadata = deploy("MockMetadata", abi=MOCK_ABI, bytecode=MOCK_BYTECODE)
    twamm = "0x0000000000000000000000000000000000000000"

    # 2. Deploy Factory
    print("Step 2: Deploying RLDMarketFactory...")
    factory = deploy("RLDMarketFactory", args=[
        pool_manager,
        pos_token_impl,
        prime_broker_impl,
        v4_oracle,
        funding_model,
        twamm,
        metadata,
        86400 # 1 Day
    ])

    
    # 3. Deploy Core
    # constructor(address _factory, address _poolManager, address _twamm)
    print("Step 3: Deploying RLDCore...")
    core = deploy("RLDCore", args=[
        factory,
        pool_manager,
        twamm
    ])
    
    # 4. Initialize Factory with Core
    print("Step 4: Initialize Factory...")
    factory_contract = w3.eth.contract(address=factory, abi=load_abi("RLDMarketFactory")[0])
    tx = factory_contract.functions.initializeCore(core).build_transaction({
        'from': account.address,
        'nonce': w3.eth.get_transaction_count(account.address),
        'gas': 200000,
        'maxFeePerGas': w3.to_wei('2', 'gwei'),
        'maxPriorityFeePerGas': w3.to_wei('1', 'gwei'),
    })
    signed = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
    w3.eth.send_raw_transaction(signed.raw_transaction)
    print("✅ Factory Initialized")

    # 5. Update shared/addresses.json
    addresses = {
        "RLDMarketFactory": factory,
        "RLDCore": core,
        "PoolManager": pool_manager,
        "DefaultOracle": v4_oracle
    }
    
    with open("../shared/addresses.json", "w") as f:
        json.dump(addresses, f, indent=4)
        
    print("💾 Updated shared/addresses.json")
    print("✅ Initialization Complete")

if __name__ == "__main__":
    main()
