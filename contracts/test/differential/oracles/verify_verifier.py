import json
import os
import random
from eth_utils import to_checksum_address, keccak

def compute_create2_address(factory, salt, bytecode):
    # CREATE2: keccak256(0xff ++ factory ++ salt ++ keccak256(bytecode))[12:]
    prefix = b'\xff'
    factory_bytes = bytes.fromhex(factory[2:])
    salt_bytes = bytes.fromhex(salt[2:])
    bytecode_hash = keccak(bytecode)
    
    raw = prefix + factory_bytes + salt_bytes + bytecode_hash
    address_bytes = keccak(raw)[12:]
    return to_checksum_address(address_bytes)

def compute_clones_address(factory, implementation, salt):
    """
    Predicts address of a Clones.cloneDeterministic(implementation, salt)
    Standard EIP-1167 Bytecode:
    363d3d373d3d3d363d73bebebebebebebebebebebebebebebebebebebebe5af43d82803e903d91602b57fd5bf3
    Where 'bebe...' is the implementation address.
    """
    implementation_clean = implementation[2:].lower()
    
    # EIP-1167 Bytecode Construction
    # Pushes implementation address to stack and delegates call
    bytecode_hex = (
        "3d602d80600a3d3981f3363d3d373d3d3d363d73" + 
        implementation_clean + 
        "5af43d82803e903d91602b57fd5bf3"
    )
    
    # Wait, Clones.sol uses a slightly different optimized bytecode for deployment?
    # OpenZeppelin Clones.sol source:
    # mstore(0x00, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73)
    # mstore(0x14, target)
    # mstore(0x28, 0x5af43d82803e903d91602b57fd5bf3)
    # This is the 'init code' that returns the runtime code.
    # The actual code deployed is the runtime code.
    # But CREATE2 hashes the INIT code (creation code).
    
    # Correct Creation Code for EIP-1167 Proxy:
    creation_code = bytes.fromhex(
        "3d602d80600a3d3981f3363d3d373d3d3d363d73" + 
        implementation_clean + 
        "5af43d82803e903d91602b57fd5bf3"
    )
    
    return compute_create2_address(factory, salt, creation_code)

def generate_fuzz_vectors(count=1000):
    vectors = []
    print(f"Generating {count} Fuzz Vectors...")
    
    for i in range(count):
        # Random inputs
        impl = f"0x{random.getrandbits(160):040x}"
        factory = f"0x{random.getrandbits(160):040x}"
        salt = f"0x{random.getrandbits(256):064x}"
        
        predicted = compute_clones_address(factory, impl, salt)
        
        vectors.append({
            "name": f"Fuzz #{i}",
            "implementation": impl,
            "factory": factory,
            "salt": salt,
            "expectedBroker": predicted
        })
    return vectors

def process_scenarios():
    input_path = os.path.join(os.path.dirname(__file__), '../scenarios/verifier.json')
    with open(input_path, 'r') as f:
        data = json.load(f)
    
    results = []
    for item in data['scenarios']:
        predicted = compute_clones_address(item['factory'], item['implementation'], item['salt'])
        
        results.append({
            "name": item['name'],
            "implementation": item['implementation'],
            "factory": item['factory'],
            "salt": item['salt'],
            "expectedBroker": predicted
        })

    fuzz_results = generate_fuzz_vectors(1000)
    
    full_output = {
        "static": results,
        "fuzz": fuzz_results
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '../data/verifier.json')
    with open(output_path, 'w') as f:
        json.dump(full_output, f, indent=2)
        
    print(f"Successfully wrote {len(results)} static and {len(fuzz_results)} fuzz scenarios.")

if __name__ == "__main__":
    process_scenarios()
