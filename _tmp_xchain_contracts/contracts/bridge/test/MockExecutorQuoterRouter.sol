// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import { IExecutorQuoterRouter } from "wormhole-sdk/interfaces/IExecutor.sol";

contract MockExecutorQuoterRouter is IExecutorQuoterRouter {
    uint256 private _executorFee;

    event RequestExecution(
        uint256 msgValue,
        uint16 dstChain,
        bytes32 dstAddr,
        address refundAddr,
        address quoterAddr,
        bytes requestBytes,
        bytes relayInstructions
    );

    function setExecutorFee(uint256 newExecutorFee) external {
        _executorFee = newExecutorFee;
    }

    function quoteExecution(
        uint16,
        bytes32,
        address,
        address,
        bytes calldata,
        bytes calldata
    ) external view returns (uint256) {
        return _executorFee;
    }

    function requestExecution(
        uint16 dstChain,
        bytes32 dstAddr,
        address refundAddr,
        address quoterAddr,
        bytes calldata requestBytes,
        bytes calldata relayInstructions
    ) external payable {
        emit RequestExecution(msg.value, dstChain, dstAddr, refundAddr, quoterAddr, requestBytes, relayInstructions);
    }
}
