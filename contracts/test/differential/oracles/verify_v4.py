import json
import os
import random
import math
from decimal import Decimal, getcontext, ROUND_FLOOR

# Set Precision
getcontext().prec = 100
WAD = Decimal("10") ** 18
Q96 = Decimal(2**96)

def mul_wad_down(a, b):
    return (a * b) // WAD

def get_sqrt_ratio_at_tick(tick):
    """
    Calculates sqrt(1.0001^tick) * Q96
    """
    return Decimal(1.0001).sqrt() ** tick * Q96

def get_amount0_for_liquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity):
    """
    Amount0 = L * (sqrtB - sqrtA) / (sqrtA * sqrtB)
    """
    if sqrtRatioAX96 > sqrtRatioBX96:
        sqrtRatioAX96, sqrtRatioBX96 = sqrtRatioBX96, sqrtRatioAX96
        
    numerator = Decimal(liquidity) * (sqrtRatioBX96 - sqrtRatioAX96)
    denominator = sqrtRatioBX96 * sqrtRatioAX96
    
    return int(numerator * Q96 / denominator)

def get_amount1_for_liquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity):
    """
    Amount1 = L * (sqrtB - sqrtA)
    """
    if sqrtRatioAX96 > sqrtRatioBX96:
        sqrtRatioAX96, sqrtRatioBX96 = sqrtRatioBX96, sqrtRatioAX96
        
    return int(Decimal(liquidity) * (sqrtRatioBX96 - sqrtRatioAX96) / Q96)

def get_amounts_for_liquidity(sqrtRatioX96, sqrtRatioAX96, sqrtRatioBX96, liquidity):
    if sqrtRatioAX96 > sqrtRatioBX96:
        sqrtRatioAX96, sqrtRatioBX96 = sqrtRatioBX96, sqrtRatioAX96

    amount0 = 0
    amount1 = 0

    if sqrtRatioX96 <= sqrtRatioAX96:
        # Current Price < Range. All in Token0.
        amount0 = get_amount0_for_liquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity)
    elif sqrtRatioX96 < sqrtRatioBX96:
        # Current Price in Range. Mix.
        amount0 = get_amount0_for_liquidity(sqrtRatioX96, sqrtRatioBX96, liquidity)
        amount1 = get_amount1_for_liquidity(sqrtRatioAX96, sqrtRatioX96, liquidity)
    else:
        # Current Price > Range. All in Token1.
        amount1 = get_amount1_for_liquidity(sqrtRatioAX96, sqrtRatioBX96, liquidity)
        
    return amount0, amount1

def compute_v4_value(liquidity, tick_current, tick_lower, tick_upper, price0, price1):
    # 1. Get SqrtPrices
    sqrt_current = get_sqrt_ratio_at_tick(tick_current)
    sqrt_lower = get_sqrt_ratio_at_tick(tick_lower)
    sqrt_upper = get_sqrt_ratio_at_tick(tick_upper)
    
    # 2. Get Amounts
    amt0, amt1 = get_amounts_for_liquidity(sqrt_current, sqrt_lower, sqrt_upper, liquidity)
    
    # 3. Value
    val0 = mul_wad_down(Decimal(amt0), Decimal(price0))
    val1 = mul_wad_down(Decimal(amt1), Decimal(price1))
    
    return int(val0 + val1)

def generate_fuzz_vectors(count=1000):
    vectors = []
    print(f"Generating {count} Fuzz Vectors...")
    
    for i in range(count):
        # Liquidity (uint128)
        liquidity = random.randint(1000, 10**24)
        
        # Ticks (approx ranges)
        # Uniswap Ticks: -887272 to 887272
        tick_lower = random.randint(-100000, 100000)
        width = random.randint(60, 10000) # Minimum tick spacing usually 60
        tick_upper = tick_lower + width
        
        # Current tick somewhere around
        tick_current = random.randint(tick_lower - width, tick_upper + width)
        
        # Prices (WAD)
        price0 = random.randint(1, 10**22)
        price1 = random.randint(1, 10**22)
        
        expected_value = compute_v4_value(liquidity, tick_current, tick_lower, tick_upper, price0, price1)
        
        vectors.append({
            "name": f"Fuzz #{i}",
            "liquidity": liquidity,
            "tickLower": tick_lower,
            "tickUpper": tick_upper,
            "tickCurrent": tick_current,
            "price0": price0,
            "price1": price1,
            "expectedValue": expected_value
        })
    return vectors

def process_scenarios():
    fuzz_results = generate_fuzz_vectors(50) # Reduced count to save time/gas
    
    full_output = {
        "fuzz": fuzz_results
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '../data/v4.json')
    with open(output_path, 'w') as f:
        json.dump(full_output, f, indent=2)
        
    print(f"Successfully wrote {len(fuzz_results)} fuzz scenarios.")

if __name__ == "__main__":
    process_scenarios()
