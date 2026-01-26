import json
import os
import random
from eth_utils import keccak, to_checksum_address
from eth_abi import encode

# Constants & Enums
ACTION_SUPPLY = 1
ACTION_WITHDRAW = 2
ACTION_BORROW = 3
ACTION_REPAY = 4

# Mock Constants
AAVE_POOL = "0xA000000000000000000000000000000000000000"
CORE = "0xC000000000000000000000000000000000000000" # Test MockAddress

def compute_calldata(action, asset, amount, user):
    """
    Predicts the Calldata that Adapter makes to the Pool
    """
    # Selectors
    # supply(address,uint256,address,uint16)
    sel_supply = keccak(b"supply(address,uint256,address,uint16)")[:4]
    # withdraw(address,uint256,address)
    sel_withdraw = keccak(b"withdraw(address,uint256,address)")[:4]
    # borrow(address,uint256,uint256,uint16,address)
    sel_borrow = keccak(b"borrow(address,uint256,uint256,uint16,address)")[:4]
    # repay(address,uint256,uint256,address)
    sel_repay = keccak(b"repay(address,uint256,uint256,address)")[:4]

    expected_calldata = "0x"
    
    if action == ACTION_SUPPLY:
        # supply(asset, amount, user, 0)
        # Assuming Adapter passes msg.sender (CORE) as onBehalfOf
        encoded = encode(['address', 'uint256', 'address', 'uint16'], [asset, amount, user, 0])
        expected_calldata = "0x" + sel_supply.hex() + encoded.hex()
        
    elif action == ACTION_WITHDRAW:
        # withdraw(asset, amount, user)
        encoded = encode(['address', 'uint256', 'address'], [asset, amount, user])
        expected_calldata = "0x" + sel_withdraw.hex() + encoded.hex()
        
    elif action == ACTION_BORROW:
        # borrow(asset, amount, 2, 0, adapterAddress?)
        # Logic check: Adapter calls borrow for ITSELF usually then forwards?
        # Or requests onBehalfOf user if delegated.
        # Current implementation assumes Adapter Logic.
        # Let's assume onBehalfOf = Adapter (address(this) in solidity context)
        # But we don't know Adapter address here.
        # WAIT: Verification Test will verify what the Adapter sends.
        # If Solidity test uses a specific Adapter address, we need to know it.
        # For now, let's skip Borrow/Repay until we confirm logic deep dive.
        # Focusing on Supply/Withdraw.
        pass

    return expected_calldata

def generate_fuzz_vectors(count=1000):
    vectors = []
    print(f"Generating {count} Fuzz Vectors...")
    
    for i in range(count):
        # Random inputs
        action = random.choice([ACTION_SUPPLY, ACTION_WITHDRAW])
        asset = f"0x{random.getrandbits(160):040x}"
        amount = random.randint(1, 10**27) # up to a billion ether
        
        # User in the test context will be the Test Contract (CORE)
        user = CORE 
        
        expected_calldata = compute_calldata(action, to_checksum_address(asset), amount, user)
        
        vectors.append({
            "name": f"Fuzz #{i}",
            "action": action,
            "asset": to_checksum_address(asset),
            "amount": amount,
            "user": user,
            "expectedCalldata": expected_calldata
        })
    return vectors

def process_scenarios():
    fuzz_results = generate_fuzz_vectors(50)
    
    full_output = {
        "fuzz": fuzz_results
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '../data/adapter.json')
    with open(output_path, 'w') as f:
        json.dump(full_output, f, indent=2)
        
    print(f"Successfully wrote {len(fuzz_results)} fuzz scenarios.")

if __name__ == "__main__":
    process_scenarios()
