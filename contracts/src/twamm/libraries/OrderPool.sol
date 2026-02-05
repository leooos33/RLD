// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.15;

/// @title TWAMM OrderPool - Represents an OrderPool inside of a TWAMM
library OrderPool {
    /// @notice Information related to a long term order pool.
    /// @member sellRateCurrent The total current sell rate (sellAmount / second) among all orders
    /// @member sellRateEndingAtInterval Mapping (timestamp => sellRate) The amount of expiring sellRate at this interval
    /// @member earningsFactor Sum of (salesEarnings_k / salesRate_k) over every period k. Stored as Fixed Point X96.
    /// @member earningsFactorAtInterval Mapping (timestamp => sellRate) The earnings factor accrued by a certain time interval. Stored as Fixed Point X96.
    struct State {
        uint256 sellRateCurrent;
        uint256 sellRateAccounted;
        mapping(uint256 => uint256) sellRateEndingAtInterval;
        //
        uint256 earningsFactorCurrent;
        mapping(uint256 => uint256) earningsFactorAtInterval;
    }

    // Performs all updates on an OrderPool, without committing the changes
    // @dev Must be followed by `advanceToInterval` to commit
    function advanceWithoutCommit(State storage self, uint256 earningsFactor, uint256 usedSellRate) internal {
        unchecked {
            self.earningsFactorCurrent += earningsFactor;
            self.sellRateAccounted = usedSellRate;
        }
    }

    // Performs all updates on an OrderPool that must happen when hitting an expiration interval with expiring orders
    function advanceToInterval(State storage self, uint256 expiration, uint256 earningsFactor) internal {
        unchecked {
            self.earningsFactorCurrent += earningsFactor;
            self.earningsFactorAtInterval[expiration] = self.earningsFactorCurrent;
            self.sellRateCurrent -= self.sellRateEndingAtInterval[expiration];
            self.sellRateAccounted = 0;
        }
    }
    function commit(State storage self, uint256 earningsFactor, uint256 usedSellRate) internal {
        advanceWithoutCommit(self, earningsFactor, usedSellRate);
    }

    /// @notice Records the current earnings factor for orders expiring at this interval
    /// @dev Called AFTER commit() has updated earningsFactorCurrent
    /// @param self The order pool state
    /// @param expiration The expiration timestamp
    function recordExpirationFactor(State storage self, uint256 expiration) internal {
        // Only record if there are orders expiring at this interval
        if (self.sellRateEndingAtInterval[expiration] > 0) {
            self.earningsFactorAtInterval[expiration] = self.earningsFactorCurrent;
            // Reduce sellRateCurrent by the amount expiring
            self.sellRateCurrent -= self.sellRateEndingAtInterval[expiration];
            // Reset accounted since we've finalized this interval
            self.sellRateAccounted = 0;
        }
    }
}
