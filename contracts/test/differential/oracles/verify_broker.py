import json
import os
import random
from decimal import Decimal, getcontext, ROUND_FLOOR

# Set Precision
getcontext().prec = 50
WAD = Decimal("10") ** 18

def mul_wad_down(a, b):
    return (a * b) // WAD

def compute_twamm_value(sell_refund, buy_owed, sell_price, buy_price):
    """
    Simulates TwammBrokerModule.getValue
    Value = (SellRefund * SellPrice) + (BuyOwed * BuyPrice)
    Using FixedPointMathLib.mulWadDown behavior
    """
    val_refund = mul_wad_down(Decimal(sell_refund), Decimal(sell_price))
    val_earnings = mul_wad_down(Decimal(buy_owed), Decimal(buy_price))
    
    return int(val_refund + val_earnings)

def generate_fuzz_vectors(count=1000):
    vectors = []
    print(f"Generating {count} Fuzz Vectors...")
    
    for i in range(count):
        # Random inputs (in Wei)
        sell_refund = random.randint(0, 10**25) # Up to 10M tokens
        buy_owed = random.randint(0, 10**25)
        
        # Prices (Wad)
        sell_price = random.randint(1, 10**22) # 1e-18 to 10000.0
        buy_price = random.randint(1, 10**22)
        
        expected_value = compute_twamm_value(sell_refund, buy_owed, sell_price, buy_price)
        
        vectors.append({
            "name": f"Fuzz #{i}",
            "sellRefund": sell_refund,
            "buyOwed": buy_owed,
            "sellPrice": sell_price,
            "buyPrice": buy_price,
            "expectedValue": expected_value
        })
    return vectors

def process_scenarios():
    fuzz_results = generate_fuzz_vectors(1000)
    
    full_output = {
        "fuzz": fuzz_results
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '../data/broker.json')
    with open(output_path, 'w') as f:
        json.dump(full_output, f, indent=2)
        
    print(f"Successfully wrote {len(fuzz_results)} fuzz scenarios.")

if __name__ == "__main__":
    process_scenarios()
