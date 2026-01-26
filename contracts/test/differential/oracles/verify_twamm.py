import json
import os
import random
from decimal import Decimal, getcontext

# Set Precision high for consistency checks
getcontext().prec = 50
SCALER = Decimal("10") ** 18
X96 = Decimal(2**96)

def to_x96(val):
    return int(val * X96)

def from_x96(val):
    return Decimal(val) / X96

class Order:
    def __init__(self, id, sell_rate):
        self.id = id
        self.sell_rate = Decimal(sell_rate)
        self.claimed = Decimal(0)
        self.start_factor = Decimal(0)

class Pool:
    def __init__(self):
        self.orders = {}
        self.total_sell_rate = Decimal(0)
        self.earnings_factor = Decimal(0)
        self.total_earnings = Decimal(0)

    def add_order(self, order_id, sell_rate):
        order = Order(order_id, sell_rate)
        order.start_factor = self.earnings_factor
        self.orders[order_id] = order
        self.total_sell_rate += order.sell_rate

    def remove_order(self, order_id):
        if order_id not in self.orders: return 0
        order = self.orders[order_id]
        
        # Claim logic: (CurrentFactor - StartFactor) * SellRate
        earnings = (self.earnings_factor - order.start_factor) * order.sell_rate
        
        self.total_sell_rate -= order.sell_rate
        del self.orders[order_id]
        
        return int(earnings) # Return claimed amount

    def distribute_earnings(self, total_earnings):
        if self.total_sell_rate == 0: return
        
        # Factor += Earnings / TotalRate
        # In Solidity: X96 Fixed Point
        # Here: Decimal
        inc = Decimal(total_earnings) / self.total_sell_rate
        self.earnings_factor += inc
        self.total_earnings += Decimal(total_earnings)

def generate_scenarios(count=50):
    scenarios = []
    
    for i in range(count):
        steps = []
        pool = Pool()
        
        # Random sequence of events (Add, Distribute, Remove)
        # We want to verify that `claimed sum` == `distributed sum` (approx)
        
        total_distributed = Decimal(0)
        total_claimed = Decimal(0)
        
        events_num = random.randint(10, 50)
        
        for e in range(events_num):
            action = random.choice(["ADD", "DIST", "REM", "DIST", "DIST"]) # Bias towards distribution
            
            if action == "ADD":
                oid = f"order_{e}"
                rate = random.randint(100, 10000)
                pool.add_order(oid, rate)
                steps.append({
                    "type_": "ADD", 
                    "id": e, 
                    "rate": rate,
                    "amount": 0,
                    "expectedClaim": 0
                })
                
            elif action == "REM":
                if not pool.orders: continue
                oid = random.choice(list(pool.orders.keys()))
                claimed = pool.remove_order(oid)
                total_claimed += Decimal(claimed)
                # Parse ID back
                uid = int(oid.split("_")[1])
                steps.append({
                    "type_": "REM", 
                    "id": uid, 
                    "expectedClaim": claimed,
                    "rate": 0,
                    "amount": 0
                })
                
            elif action == "DIST":
                if pool.total_sell_rate == 0: continue
                amount = random.randint(1000, 100000)
                pool.distribute_earnings(amount)
                total_distributed += Decimal(amount)
                steps.append({
                    "type_": "DIST", 
                    "amount": amount,
                    "id": 0,
                    "rate": 0,
                    "expectedClaim": 0
                })
        
        # Claim remaining
        for oid in list(pool.orders.keys()):
            claimed = pool.remove_order(oid)
            total_claimed += Decimal(claimed)
            uid = int(oid.split("_")[1])
            steps.append({
                "type_": "REM", 
                "id": uid, 
                "expectedClaim": claimed,
                "rate": 0,
                "amount": 0
            })
            
        scenarios.append({
            "name": f"Scenario #{i}",
            "steps": steps,
            "totalDistributed": int(total_distributed),
            "totalClaimed": int(total_claimed)
        })
        
    return scenarios

def process():
    data = {"scenarios": generate_scenarios(20)}
    path = os.path.join(os.path.dirname(__file__), '../data/twamm.json')
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print("Generated TWAMM Scenarios")

if __name__ == "__main__":
    process()
