import json
import os
import random
from decimal import Decimal, getcontext

# Set Precision
getcontext().prec = 50
WAD = Decimal("10") ** 18

def mul_wad(a, b):
    return (a * b) // WAD

def is_solvent(principal, norm_factor, index_price, account_value, min_ratio):
    # True Debt = Principal * NormFactor
    true_debt = mul_wad(Decimal(principal), Decimal(norm_factor))
    
    # Debt Value = TrueDebt * IndexPrice
    debt_value = mul_wad(true_debt, Decimal(index_price))
    
    # Required Value = DebtValue * Ratio
    required_value = mul_wad(debt_value, Decimal(min_ratio))
    
    # Solvency Check
    return Decimal(account_value) >= required_value

def generate_fuzz_vectors(count=1000):
    vectors = []
    print(f"Generating {count} Fuzz Vectors...")
    
    for i in range(count):
        # Random inputs
        principal = random.randint(0, 10**24) # Up to 1M scale
        norm_factor = random.randint(10**18, 5 * 10**18) # 1.0 to 5.0
        index_price = random.randint(10**18, 5000 * 10**18) # 1.0 to 5000.0
        min_ratio = random.randint(10**18, 2 * 10**18) # 100% to 200%
        
        # Determine Account Value around the solvency data point
        # Calculate Threshold
        true_debt = mul_wad(Decimal(principal), Decimal(norm_factor))
        debt_val = mul_wad(true_debt, Decimal(index_price))
        threshold = mul_wad(debt_val, Decimal(min_ratio))
        
        # Flip a coin to decides if clean solvent or barely insolvent
        if random.random() > 0.5:
             # Solvent (Threshold + Random buffer)
             account_value = int(threshold) + random.randint(0, 10**18)
        else:
             # Insolvent (Threshold - Random buffer)
             # Max buffer shouldn't exceed threshold
             if threshold == 0:
                 account_value = 0
             else:
                 deduct = random.randint(1, int(10**18))
                 account_value = int(threshold) - deduct
                 if account_value < 0: account_value = 0
        
        expected = is_solvent(principal, norm_factor, index_price, account_value, min_ratio)
        
        vectors.append({
            "name": f"Core Fuzz #{i}",
            "principal": principal,
            "normFactor": norm_factor,
            "indexPrice": index_price,
            "accountValue": account_value,
            "minRatio": min_ratio,
            "isSolvent": expected
        })
    return vectors

def process_scenarios():
    fuzz_results = generate_fuzz_vectors(1000)
    
    full_output = {
        "fuzz": fuzz_results
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '../data/core.json')
    with open(output_path, 'w') as f:
        json.dump(full_output, f, indent=2)
        
    print(f"Successfully wrote {len(fuzz_results)} fuzz scenarios.")

if __name__ == "__main__":
    process_scenarios()
