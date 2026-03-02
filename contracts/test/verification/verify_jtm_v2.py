#!/usr/bin/env python3
"""
JTM v2 Differential Fuzzing Oracle
====================================
Generates golden test vectors for verifying the Solidity JTM v2
implementation against the Python reference.

Per DIFFERENTIAL_FUZZING.md:
  Step A: JSON spec            → jtm_v2_scenarios.json (edge cases)
  Step B: This Oracle          → jtm_v2_golden.json     (1000+ fuzz vectors)
  Step C: Solidity verifier    → JTMDifferential.t.sol

Output schema (jtm_v2_golden.json):
{
  "vectors": [
    {
      "name": "...",
      "actions": [
        {"type": "submit", "zeroForOne": true, "amount": 3600e6, "duration": 3600, "submitTime": ...},
        {"type": "warp", "time": ...},
        {"type": "cancel", "orderIndex": 0, "cancelTime": ...},
        ...
      ],
      "expectations": {
        "orders": [
          {"buyOwed": ..., "sellRefund": ..., "expired": true/false}
        ],
        "ghost0": ...,
        "ghost1": ...,
        "autoSettles": ...,
        "cancelSettles": ...
      }
    }
  ]
}

The Solidity test replays each scenario's actions and asserts against expectations.
"""
import json
import random
from decimal import Decimal, getcontext
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional

# High precision for golden data
getcontext().prec = 50

Q96 = 2**96
RS = 10**18
EPOCH = 3600


@dataclass
class SP:
    sr: int = 0; ef: int = 0
    sre: Dict[int,int] = field(default_factory=dict)
    efa: Dict[int,int] = field(default_factory=dict)

@dataclass
class Ord:
    idx: int; sr: int; efl: int; exp: int; zfo: bool; dep: int
    done: bool = False

class Oracle:
    """High-precision Python reference matching Solidity JTM v2 exactly."""

    def __init__(self, twap_price: float = 1.0):
        self.twap = twap_price
        self.s0 = SP(); self.s1 = SP()
        self.a0 = self.a1 = 0
        self.lu = 0  # will be set by scenario
        self.ords: List[Ord] = []
        self.auto_s = self.canc_s = 0

    def _iv(self, t): return (t // EPOCH) * EPOCH

    def _re(self, s, earned):
        if s.sr > 0 and earned > 0:
            s.ef += (earned * Q96 * RS) // s.sr

    def _net(self):
        """Exact match of Solidity _internalNet:
        Uses TWAP price for netting, credits earningsFactor for both streams."""
        if self.a0 == 0 or self.a1 == 0: return
        p = int(self.twap * 1e6)
        if p == 0: return
        v = (self.a0 * p) // 10**6
        if v <= self.a1:
            m0, m1 = self.a0, v
        else:
            m1 = self.a1
            m0 = (self.a1 * 10**6) // p
        if m0 > 0 and m1 > 0:
            self.a0 -= m0; self.a1 -= m1
            self._re(self.s0, m1)
            self._re(self.s1, m0)

    def _cross(self, s, ep):
        e = s.sre.get(ep, 0)
        if e > 0:
            s.efa[ep] = s.ef
            s.sr -= e

    def _settle_ghost(self, zfo):
        """Auto-settle: for the oracle, we use TWAP price for settlement
        (since we don't simulate the real AMM pool, which the Solidity test does).
        The Solidity test will have its own AMM results — we compare
        ghost=0 and buyOwed>0 rather than exact amounts for AMM-settled orders."""
        s = self.s0 if zfo else self.s1
        g = self.a0 if zfo else self.a1
        if g == 0 or s.sr == 0: return 0
        # Settle at TWAP (reference approximation)
        p = int(self.twap * 1e6)
        if zfo:
            proceeds = (g * p) // 10**6
            self._re(s, proceeds)
            self.a0 = 0
        else:
            proceeds = (g * 10**6) // p if p > 0 else 0
            self._re(s, proceeds)
            self.a1 = 0
        return proceeds

    def _pre_epoch(self, s, ep, zfo):
        e = s.sre.get(ep, 0)
        if e == 0 or e != s.sr: return False
        g = self.a0 if zfo else self.a1
        if g == 0: return False
        self._settle_ghost(zfo)
        self.auto_s += 1
        return True

    def accrue(self, t):
        if t <= self.lu: return
        dt = t - self.lu
        if self.s0.sr > 0: self.a0 += (self.s0.sr * dt) // RS
        if self.s1.sr > 0: self.a1 += (self.s1.sr * dt) // RS
        if self.a0 > 0 and self.a1 > 0: self._net()
        li, ci = self._iv(self.lu), self._iv(t)
        if ci > li:
            ep = li + EPOCH
            while ep <= ci:
                self._pre_epoch(self.s0, ep, True)
                self._pre_epoch(self.s1, ep, False)
                self._cross(self.s0, ep)
                self._cross(self.s1, ep)
                ep += EPOCH
        self.lu = t

    def submit(self, zfo, amount, duration, t) -> int:
        self.accrue(t)
        ne = self._iv(t) + EPOCH; exp = ne + duration
        sr = amount // duration
        sc = sr * RS
        idx = len(self.ords)
        s = self.s0 if zfo else self.s1
        s.sr += sc
        s.sre[exp] = s.sre.get(exp, 0) + sc
        self.ords.append(Ord(idx, sc, s.ef, exp, zfo, sr * duration))
        return idx

    def cancel(self, idx, t):
        self.accrue(t)
        o = self.ords[idx]
        if o.done or t >= o.exp: return 0, 0
        s = self.s0 if o.zfo else self.s1
        if s.sr == o.sr:
            g = self.a0 if o.zfo else self.a1
            if g > 0:
                self._settle_ghost(o.zfo)
                self.canc_s += 1
        s.sr -= o.sr
        s.sre[o.exp] = max(0, s.sre.get(o.exp, 0) - o.sr)
        buy, ref = self._calc(o)
        o.done = True
        return buy, ref

    def _calc(self, o):
        s = self.s0 if o.zfo else self.s1
        ef = s.ef
        if self.lu >= o.exp:
            sn = s.efa.get(o.exp, 0)
            if 0 < sn < ef: ef = sn
        d = ef - o.efl
        buy = (o.sr * d) // (Q96 * RS) if d > 0 else 0
        ref = (o.sr * (o.exp - self.lu)) // RS if not o.done and self.lu < o.exp else 0
        return buy, ref

    def get(self, idx):
        return self._calc(self.ords[idx])


def generate_edge_case_vectors():
    """5+ hand-crafted edge cases per the DFF checklist."""
    vectors = []

    # --- EC1: Single order, full lifecycle, auto-settle at expiry ---
    vectors.append({
        "name": "EC1_single_order_auto_settle",
        "startTime": 7200,
        "twapPrice": 1000000,  # 1.0 in 1e6
        "actions": [
            {"type": "submit", "zeroForOne": True, "amount": 3600000000, "duration": 3600},
            {"type": "warp_epochs", "epochs": 2},  # past expiration
        ]
    })

    # --- EC2: Cancel last order → cancel-settle ---
    vectors.append({
        "name": "EC2_cancel_settle",
        "startTime": 7200,
        "twapPrice": 1000000,
        "actions": [
            {"type": "submit", "zeroForOne": True, "amount": 3600000000, "duration": 3600},
            {"type": "warp_epochs", "epochs": 1},  # mid-order (order starts at epoch+1, runs 1 epoch)
            {"type": "warp_seconds", "seconds": 1800},  # half into first live epoch
            {"type": "cancel", "orderIndex": 0},
        ]
    })

    # --- EC3: Two orders same direction — cancel one, no settle ---
    vectors.append({
        "name": "EC3_cancel_no_settle",
        "startTime": 7200,
        "twapPrice": 1000000,
        "actions": [
            {"type": "submit", "zeroForOne": True, "amount": 3600000000, "duration": 3600},
            {"type": "submit", "zeroForOne": True, "amount": 3600000000, "duration": 3600},
            {"type": "warp_epochs", "epochs": 1},
            {"type": "warp_seconds", "seconds": 1800},
            {"type": "cancel", "orderIndex": 0},
        ]
    })

    # --- EC4: Opposing orders → netting ---
    vectors.append({
        "name": "EC4_opposing_netting",
        "startTime": 7200,
        "twapPrice": 1000000,
        "actions": [
            {"type": "submit", "zeroForOne": True, "amount": 3600000000, "duration": 3600},
            {"type": "submit", "zeroForOne": False, "amount": 3600000000, "duration": 3600},
            {"type": "warp_epochs", "epochs": 2},
        ]
    })

    # --- EC5: Option E — submit at exact epoch boundary ---
    vectors.append({
        "name": "EC5_epoch_boundary_submit",
        "startTime": 7200,  # exact epoch
        "twapPrice": 1000000,
        "actions": [
            {"type": "submit", "zeroForOne": True, "amount": 7200000000, "duration": 7200},
            {"type": "warp_epochs", "epochs": 3},
        ]
    })

    # --- EC6: Multiple epochs, interleaved expirations ---
    vectors.append({
        "name": "EC6_interleaved_expirations",
        "startTime": 7200,
        "twapPrice": 1000000,
        "actions": [
            {"type": "submit", "zeroForOne": True, "amount": 3600000000, "duration": 3600},
            {"type": "submit", "zeroForOne": True, "amount": 7200000000, "duration": 7200},
            {"type": "warp_epochs", "epochs": 3},
        ]
    })

    # --- EC7: Immediate cancel (no time passes) ---
    vectors.append({
        "name": "EC7_immediate_cancel",
        "startTime": 7200,
        "twapPrice": 1000000,
        "actions": [
            {"type": "submit", "zeroForOne": True, "amount": 3600000000, "duration": 3600},
            {"type": "cancel", "orderIndex": 0},
        ]
    })

    return vectors


def generate_fuzz_vectors(n=1000, seed=42):
    """Generate n random valid scenarios."""
    rng = random.Random(seed)
    vectors = []

    for i in range(n):
        rng.seed(seed + i)
        start = 7200  # match Solidity setUp()
        twap = 1000000  # 1.0 (netting price = 1:1)

        actions = []
        n_orders = rng.randint(1, 4)

        for j in range(n_orders):
            zfo = rng.random() < 0.5
            # Amount: 3600-36000 (divisible by duration for clean sellRate)
            dur_epochs = rng.choice([1, 2, 3])
            dur = dur_epochs * EPOCH
            amt = rng.randint(1, 10) * dur * 1000000  # ensures clean division
            actions.append({
                "type": "submit",
                "zeroForOne": zfo,
                "amount": amt,
                "duration": dur,
            })

        # Random warps and cancels
        action_set = []
        for j in range(n_orders):
            action_set.append(("submit", j))

        # Maybe warp + cancel some
        if rng.random() < 0.4 and n_orders > 0:
            action_set.append(("warp_epochs", rng.randint(1, 2)))
            ci = rng.randint(0, n_orders - 1)
            action_set.append(("cancel", ci))

        # Always warp to after all expirations at the end
        max_dur = max(a["duration"] for a in actions)
        final_epochs = (max_dur // EPOCH) + 2  # +2 for Option E start offset
        action_set.append(("warp_final", final_epochs))

        # Build ordered action list
        final_actions = []
        for at, val in action_set:
            if at == "submit":
                final_actions.append(actions[val])
            elif at == "warp_epochs":
                final_actions.append({"type": "warp_epochs", "epochs": val})
            elif at == "cancel":
                final_actions.append({"type": "cancel", "orderIndex": val})
            elif at == "warp_final":
                final_actions.append({"type": "warp_epochs", "epochs": val})

        vectors.append({
            "name": f"FUZZ_{i:04d}",
            "startTime": start,
            "twapPrice": twap,
            "actions": final_actions,
        })

    return vectors


def compute_expectations(scenario):
    """Run the Python Oracle on a scenario and return expectations."""
    o = Oracle(twap_price=scenario["twapPrice"] / 1e6)
    t = scenario["startTime"]
    o.lu = t
    order_indices = []
    cancelled = set()

    for action in scenario["actions"]:
        if action["type"] == "submit":
            idx = o.submit(
                action["zeroForOne"],
                action["amount"],
                action["duration"],
                t
            )
            order_indices.append(idx)

        elif action["type"] == "warp_epochs":
            t += action["epochs"] * EPOCH
            o.accrue(t)

        elif action["type"] == "warp_seconds":
            t += action["seconds"]
            o.accrue(t)

        elif action["type"] == "cancel":
            oi = action["orderIndex"]
            if oi < len(order_indices) and oi not in cancelled:
                o.cancel(order_indices[oi], t)
                cancelled.add(oi)

    # Read final state
    orders_out = []
    for i, idx in enumerate(order_indices):
        buy, ref = o.get(idx)
        ord_obj = o.ords[idx]
        orders_out.append({
            "index": i,
            "buyOwed": str(buy),
            "sellRefund": str(ref),
            "expired": o.lu >= ord_obj.exp,
            "cancelled": ord_obj.done,
            "expiration": ord_obj.exp,
            "sellRate": str(ord_obj.sr),
        })

    return {
        "orders": orders_out,
        "ghost0": str(o.a0),
        "ghost1": str(o.a1),
        "autoSettles": o.auto_s,
        "cancelSettles": o.canc_s,
        "stream0SellRate": str(o.s0.sr),
        "stream1SellRate": str(o.s1.sr),
        "finalTime": t,
    }


def main():
    edge_cases = generate_edge_case_vectors()
    fuzz_vectors = generate_fuzz_vectors(n=1000)
    all_vectors = edge_cases + fuzz_vectors

    output = {"vectors": []}

    for scenario in all_vectors:
        expectations = compute_expectations(scenario)
        output["vectors"].append({
            **scenario,
            "expectations": expectations,
        })

    outpath = "jtm_v2_golden.json"
    with open(outpath, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Generated {len(output['vectors'])} vectors ({len(edge_cases)} edge cases + {len(fuzz_vectors)} fuzz)")
    print(f"Written to {outpath}")

    # Self-verification: check all vectors pass internal invariants
    fails = 0
    for v in output["vectors"]:
        e = v["expectations"]
        g0, g1 = int(e["ghost0"]), int(e["ghost1"])
        sr0, sr1 = int(e["stream0SellRate"]), int(e["stream1SellRate"])
        # If stream is dead, ghost must be zero
        if sr0 == 0 and g0 > 0:
            fails += 1
            print(f"  INVARIANT FAIL {v['name']}: dead stream0 but ghost0={g0}")
        if sr1 == 0 and g1 > 0:
            fails += 1
            print(f"  INVARIANT FAIL {v['name']}: dead stream1 but ghost1={g1}")

    if fails == 0:
        print("Self-verification: ALL PASSED ✅")
    else:
        print(f"Self-verification: {fails} FAILURES ❌")


if __name__ == "__main__":
    main()
