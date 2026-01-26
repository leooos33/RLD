# Protocol Standard: Differential Fuzzing Framework (DFF)

**Version**: 1.0 (Generic Standard)
**Status**: Adopted

This document specifies the **Differential Fuzzing** standard for verifying mission-critical protocol modules. All complex mathematical or state-transition logic MUST be verified using this framework before mainnet deployment.

---

## 1. The Philosophy: "Paranoid Verification"

We do not trust Solidity tests written by the same author as the contract. We verify logic by pitting two independent implementations against each other.

### The Triangle of Truth

1.  **The Spec (JSON)**: A language-agnostic definition of inputs and expected invariant behaviors.
2.  **The Oracle (Python/Rust)**: A high-precision reference implementation that prioritizes mathematical correctness over gas efficiency.
3.  **The Verifier (Solidity)**: The production code running in a test harness that consumes Oracle data.

---

## 2. Implementation Guide

### Step A: Define the "Golden Data" Schema

Create a JSON specification that captures the inputs and "Exam Questions" for your module.

_Pattern_: `contracts/test/verification/<module>_spec.json`

```json
{
  "scenarios": [
    {
      "name": "Scenario A",
      "input1": "...",
      "input2": "...",
      "description": "..."
    }
  ]
}
```

### Step B: Build the Oracle

Write a script to generate the "Answer Key".

_Pattern_: `contracts/test/verification/verify_<module>.py`
**Requirements**:

1.  **High Precision**: Use `decimal` (Python) or `BigInt` to avoid EVM rounding errors.
2.  **Invariant Defense**: The script must self-verify outputs (e.g., `if user_withdraws, bal_must_decrease`) before writing them.
3.  **Fuzzing Hose**: Function `generate_fuzz_vectors(n=1000)` that generates random valid inputs and appends them to the output.

### Step C: Build the Verifier

Write a Foundry test that consumes the answer key.

_Pattern_: `contracts/test/unit/<Module>.t.sol`

```solidity
struct ReferenceData { ScenarioResult[] fuzz_vectors; }

function test_DifferentialFuzzing() public {
    string memory json = vm.readFile("reference_outputs.json");
    ScenarioResult[] memory vectors = abi.decode(json, (ScenarioResult[]));

    for(uint i=0; i < vectors.length; i++) {
        uint256 actual = module.execute(vectors[i].inputs);
        assertApproxEqRel(actual, vectors[i].expected, TOLERANCE);
    }
}
```

---

## 3. Case Study: Funding Math Module

We successfully applied this standard to the Funding Rate mechanism.

| **Component** | **Implementation**       | **Role**                                                                                                            |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Spec**      | `funding_scenarios.json` | Defines Market/Oracle price pairs + Time deltas.                                                                    |
| **Oracle**    | `verify_funding.py`      | Python script using 50-digit precision `decimal` math. Generates 1000 random market days.                           |
| **Verifier**  | `FundingMath.t.sol`      | Foundry test consuming the 1000 vectors. Validates Solidity's `FixedPointMathLib` against Python's `Taylor Series`. |

### Results

- **Coverage**: 1000 unique market scenarios.
- **Precision**: Verified to 12 decimal places (0.000001 tokens).
- **Bugs Found**: Identified significant divergence in Solmate's `expWad` approximation at extreme ranges (>20,000% APY), allowing us to set safe bounds.

---

## 4. Checklist for New Modules

When adding a new module (e.g., Liquidation, AMM Curve), follows this checklist:

- [ ] **Spec**: Create `<module>_scenarios.json` with at least 5 edge cases.
- [ ] **Oracle**: Write logical mirror in Python.
- [ ] **Fuzz**: Generate >1000 vectors in the Oracle.
- [ ] **Verify**: Wire up Foundry to assert `Solidity == Python`.
- [ ] **Report**: Commit a markdown report detailing the tolerance thresholds used.
