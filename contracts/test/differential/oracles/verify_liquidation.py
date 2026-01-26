import json
import os
import random
from decimal import Decimal, getcontext, ROUND_FLOOR

# Set Precision to 50 digits
getcontext().prec = 50

# Constants
WAD = Decimal("10") ** 18

def mul_wad(a, b):
    """
    FixedPointMath.mulWad: (a * b) / WAD
    Solidity does integer division (floor).
    """
    return (a * b) / WAD

def div_wad(a, b):
    """
    FixedPointMath.divWad: (a * WAD) / b
    """
    return (a * WAD) / b

def calculate_dutch_seize(debt_to_cover, user_collateral, user_debt, spot_price, index_price, norm_factor, params, config):
    """
    DutchLiquidationModule Logic:
    1. HS = ColVal / (DebtVal * Maintenance)
    2. Bonus = Base + Slope * (1 - HS)
    3. Seize = Cost * (1 + Bonus) / Spot
    """
    
    # 1. Unpack Params
    # params dict: { base_discount, max_discount, slope } all in WAD
    base_discount = params['base']
    max_discount = params['max']
    slope = params['slope']
    maintenance_margin = config['maintenance']

    # 2. Calculate Health Score
    # colVal = userCollateral * spotPrice
    col_val = mul_wad(user_collateral, spot_price)
    
    # debtVal = userDebt * normFactor * indexPrice
    debt_val = mul_wad(mul_wad(user_debt, norm_factor), index_price)
    
    health_score = Decimal(0)
    if debt_val > 0:
        # HS = ColVal / (DebtVal * Maintenance)
        required_col = mul_wad(debt_val, maintenance_margin)
        health_score = div_wad(col_val, required_col)

    # 3. Calculate Bonus
    bonus = base_discount
    if health_score < WAD: # < 1.0
        insolvency_depth = WAD - health_score
        dynamic_part = mul_wad(insolvency_depth, slope)
        bonus += dynamic_part
        
    if bonus > max_discount:
        bonus = max_discount
        
    # 4. Calculate Seize
    # Cost = debtToCover * Norm * Index
    cost_in_underlying = mul_wad(mul_wad(debt_to_cover, norm_factor), index_price)
    
    # Reward = Cost * (1 + Bonus)
    reward_value = mul_wad(cost_in_underlying, WAD + bonus)
    
    # Seize = Reward / Spot
    total_seized = div_wad(reward_value, spot_price)
    
    total_seized_int = total_seized.to_integral_value(rounding=ROUND_FLOOR)
    
    # Bonus Part
    cost_in_col = div_wad(cost_in_underlying, spot_price)
    cost_in_col_int = cost_in_col.to_integral_value(rounding=ROUND_FLOOR)
    
    bonus_collateral_int = Decimal(0)
    if total_seized_int > cost_in_col_int:
        bonus_collateral_int = total_seized_int - cost_in_col_int
        
    return int(total_seized_int), int(bonus_collateral_int)

def calculate_seize_amount(debt_to_cover, user_collateral, spot_price, index_price, norm_factor, bonus_multiplier):
    """
    Static Logic
    """
    # ... existing static logic ...
    
    # 2. Cost in Underlying (Value of debt being repaid)
    # costInUnderlying = debtToCover.mulWad(normFactor).mulWad(indexPrice)
    cost_in_underlying = mul_wad(mul_wad(debt_to_cover, norm_factor), index_price)
    
    # 3. Reward Value
    # rewardValue = costInUnderlying.mulWad(liquidationBonus)
    reward_value = mul_wad(cost_in_underlying, bonus_multiplier)
    
    # 4. Total Seized Collateral
    # totalSeized = rewardValue.divWad(spotPrice)
    total_seized = div_wad(reward_value, spot_price)
    
    # Truncate to integer for final output match
    total_seized_int = total_seized.to_integral_value(rounding=ROUND_FLOOR)
    
    # 5. Bonus Part
    # costInCol = costInUnderlying.divWad(spotPrice)
    cost_in_col = div_wad(cost_in_underlying, spot_price)
    cost_in_col_int = cost_in_col.to_integral_value(rounding=ROUND_FLOOR)
    
    bonus_collateral_int = Decimal(0)
    if total_seized_int > cost_in_col_int:
        bonus_collateral_int = total_seized_int - cost_in_col_int
        
    return int(total_seized_int), int(bonus_collateral_int)

def check_invariants(debt_to_cover, spot_price, total_seized, bonus_collateral):
    """
    Paranoid Checks
    """
    # 1. Non-Negative
    if total_seized < 0 or bonus_collateral < 0:
        raise Exception("Negative Seize Amount")
        
    # 2. If Bonus > 1.0, Total Seized > Cost
    # (Hard to check exactly without re-calculating cost, but generally true)

def generate_fuzz_vectors(count=1000):
    vectors = []
    print(f"Generating {count} Fuzz Vectors...")
    
    for i in range(count):
        # Random inputs
        debt_val = random.uniform(0.1, 1_000_000)
        col_val = random.uniform(0.1, 10_000_000)
        spot_val = random.uniform(0.1, 5000)
        index_val = random.uniform(0.1, 5000)
        norm_val = random.uniform(1.0, 2.0)
        bonus_val = random.uniform(1.0, 1.25)
        
        debt_to_cover = int(Decimal(debt_val) * WAD)
        # user_collateral not used in static logic but part of interface
        user_collateral = int(Decimal(col_val) * WAD) 
        spot = int(Decimal(spot_val) * WAD)
        index = int(Decimal(index_val) * WAD)
        norm = int(Decimal(norm_val) * WAD)
        bonus = int(Decimal(bonus_val) * WAD)
        
        try:
            seize, bonus_col = calculate_seize_amount(
                Decimal(debt_to_cover), Decimal(user_collateral), 
                Decimal(spot), Decimal(index), Decimal(norm), Decimal(bonus)
            )
            
            check_invariants(debt_to_cover, spot, seize, bonus_col)
            
            vectors.append({
                "name": f"Fuzz #{i}",
                "debtToCover": debt_to_cover,
                "spotPrice": spot,
                "indexPrice": index,
                "normFactor": norm,
                "liquidationBonus": bonus,
                "expectedSeize": seize,
                "expectedBonus": bonus_col,
                # Defaults
                "type_": "",
                "baseDiscount": 0,
                "maxDiscount": 0,
                "slope": 0,
                "maintenanceMargin": 0,
                "userCollateral": user_collateral, # Fuzz uses random col
                "userDebt": 0
            })
        except Exception as e:
            print(f"Skipping vector: {e}")
            continue
            
    return vectors

def process_scenarios():
    input_path = os.path.join(os.path.dirname(__file__), '../scenarios/liquidation.json')
    with open(input_path, 'r') as f:
        data = json.load(f)
    
    results = []
    for item in data['scenarios']:
        # Convert inputs to Wei
        debt_to_cover = int(Decimal(str(item['debtToCover'])) * WAD)
        user_collateral = int(Decimal(str(item['userCollateral'])) * WAD)
        spot = int(Decimal(str(item['spotPrice'])) * WAD)
        index = int(Decimal(str(item['indexPrice'])) * WAD)
        norm = int(Decimal(str(item['normFactor'])) * WAD)
        bonus = int(Decimal(str(item['liquidationBonus'])) * WAD)
        
        if item.get('type') == 'dutch':
             # Unpack Dutch Params
             params = {
                 'base': int(Decimal(str(item['baseDiscount'])) * WAD),
                 'max': int(Decimal(str(item['maxDiscount'])) * WAD),
                 'slope': int(Decimal(str(item['slope'])) * WAD)
             }
             config = {
                 'maintenance': int(Decimal(str(item.get('maintenanceMargin', '0.1'))) * WAD)
             }
             
             # User Debt needed for Dutch
             user_debt = int(Decimal(str(item['userDebt'])) * WAD)

             seize, bonus_col = calculate_dutch_seize(
                 Decimal(debt_to_cover), Decimal(user_collateral), Decimal(user_debt),
                 Decimal(spot), Decimal(index), Decimal(norm), params, config
             )
        else:
            # Static Logic
            seize, bonus_col = calculate_seize_amount(
                Decimal(debt_to_cover), Decimal(user_collateral), 
                Decimal(spot), Decimal(index), Decimal(norm), Decimal(bonus)
            )
        
        results.append({
            "name": item['name'],
            "debtToCover": debt_to_cover,
            "spotPrice": spot,
            "indexPrice": index,
            "normFactor": norm,
            "liquidationBonus": bonus,
            "expectedSeize": seize,
            "expectedBonus": bonus_col,
            # Dutch Params (Defaults)
            "type_": "dutch" if item.get('type') == 'dutch' else "",
            "baseDiscount": int(Decimal(str(item.get('baseDiscount', '0'))) * WAD),
            "maxDiscount": int(Decimal(str(item.get('maxDiscount', '0'))) * WAD),
            "slope": int(Decimal(str(item.get('slope', '0'))) * WAD),
            "maintenanceMargin": int(Decimal(str(item.get('maintenanceMargin', '0'))) * WAD),
            "userCollateral": int(Decimal(str(item.get('userCollateral', '0'))) * WAD),
            "userDebt": int(Decimal(str(item.get('userDebt', '0'))) * WAD)
        })

    fuzz_results = generate_fuzz_vectors(1000)
    
    full_output = {
        "static": results,
        "fuzz": fuzz_results
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '../data/liquidation.json')
    with open(output_path, 'w') as f:
        json.dump(full_output, f, indent=2)
        
    print(f"Successfully wrote {len(results)} static and {len(fuzz_results)} fuzz scenarios.")

if __name__ == "__main__":
    process_scenarios()
