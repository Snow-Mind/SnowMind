// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { ICoreBridge } from "wormhole-sdk/interfaces/ICoreBridge.sol";
import { IExecutorQuoterRouter, IVaaV1Receiver } from "wormhole-sdk/interfaces/IExecutor.sol";
import { CoreBridgeLib } from "wormhole-sdk/libraries/CoreBridge.sol";
import { HashReplayProtectionLib } from "wormhole-sdk/libraries/ReplayProtection.sol";
import { VaaLib } from "wormhole-sdk/libraries/VaaLib.sol";
import { RequestLib } from "wormhole-sdk/Executor/Request.sol";
import { RelayInstructionLib } from "wormhole-sdk/Executor/RelayInstruction.sol";

import "./interfaces/IBridgeAdapter.sol";
import "./interfaces/IBridgeRouter.sol";
import "./libraries/Messages.sol";
import "./libraries/WormholeExecutorMessages.sol";
import "./libraries/Wormhole.sol";

contract WormholeExecutorDataAdapter is IBridgeAdapter, IVaaV1Receiver, AccessControlDefaultAdminRules {
    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER");

    event ReceiveMessage(bytes32 indexed messageId, bytes32 adapterAddress);

    error MessageParamsOverflow(uint256 value);
    error InvalidTargetChain(uint16 wormholeChainId);
    error InsufficientReceiverValue(uint128 expectedValue, uint256 receivedValue);

    struct WormholeAdapterParams {
        bool isAvailable;
        uint16 wormholeChainId;
        bytes32 adapterAddress;
    }

    mapping(uint16 folksChainId => WormholeAdapterParams) internal folksChainIdToWormholeAdapter;
    mapping(uint16 wormholeChainId => uint16 folksChainId) internal wormholeChainIdToFolksChainId;

    ICoreBridge public immutable wormhole;
    uint16 public immutable thisWormholeChainId;
    IExecutorQuoterRouter public immutable executorQuoterRouter;
    IBridgeRouter public immutable bridgeRouter;
    address public quoterAddress;
    address public refundAddress;

    modifier onlyBridgeRouter() {
        if (msg.sender != address(bridgeRouter)) revert InvalidBridgeRouter(msg.sender);
        _;
    }

    /**
     * @notice Constructor
     * @param admin The default admin for adapter
     * @param _wormhole The Wormhole Core to get message fees
     * @param _executorQuoterRouter The Executor to quote and request message execution
     * @param _bridgeRouter The Bridge Router to route messages through
     * @param _quoterAddress The address of the quoter
     * @param _refundAddress The address to deliver any refund to
     */
    constructor(
        address admin,
        ICoreBridge _wormhole,
        IExecutorQuoterRouter _executorQuoterRouter,
        IBridgeRouter _bridgeRouter,
        address _quoterAddress,
        address _refundAddress
    ) AccessControlDefaultAdminRules(1 days, admin) {
        wormhole = _wormhole;
        thisWormholeChainId = wormhole.chainId();
        executorQuoterRouter = _executorQuoterRouter;
        bridgeRouter = _bridgeRouter;
        quoterAddress = _quoterAddress;
        refundAddress = _refundAddress;
        _grantRole(MANAGER_ROLE, admin);
    }

    function getSendFee(Messages.MessageToSend memory message) external view override returns (uint256 fee) {
        // get chain adapter if available
        (uint16 wormholeChainId, bytes32 adapterAddress) = getChainAdapter(message.destinationChainId);

        // check for overflow
        _checkMessageParamsOverflow(message.params);

        // get executor quote
        bytes memory requestBytes = RequestLib.encodeVaaMultiSigRequest(
            thisWormholeChainId,
            Messages.convertEVMAddressToGenericAddress(address(this)),
            0 // sequence placeholder - not needed for quote
        );
        bytes memory relayInstructions = RelayInstructionLib.encodeGas(
            uint128(message.params.gasLimit),
            uint128(message.params.receiverValue)
        );
        uint256 executorFee = executorQuoterRouter.quoteExecution(
            wormholeChainId,
            adapterAddress,
            refundAddress,
            quoterAddress,
            requestBytes,
            relayInstructions
        );

        // add cost of publishing message
        return executorFee + wormhole.messageFee();
    }

    function sendMessage(Messages.MessageToSend memory message) external payable override onlyBridgeRouter {
        // get chain adapter if available
        (uint16 wormholeChainId, bytes32 adapterAddress) = getChainAdapter(message.destinationChainId);

        // check for overflow
        _checkMessageParamsOverflow(message.params);

        // ensure extra args is empty
        if (message.extraArgs.length > 0) revert UnsupportedExtraArgs();

        // prepare payload by adding metadata
        bytes memory payloadWithMetadata = WormholeExecutorMessages.encodePayloadWithWormholeExecutorMetadata(
            wormholeChainId,
            uint128(message.params.receiverValue),
            message
        );

        // publish message with nonce 0
        uint8 consistencyLevel = Wormhole.getConsistencyLevel(message.finalityLevel);
        uint256 messageFee = wormhole.messageFee();
        uint64 sequence = wormhole.publishMessage{ value: messageFee }(0, payloadWithMetadata, consistencyLevel);

        // request execution
        bytes memory requestBytes = RequestLib.encodeVaaMultiSigRequest(
            thisWormholeChainId,
            Messages.convertEVMAddressToGenericAddress(address(this)),
            sequence
        );
        bytes memory relayInstructions = RelayInstructionLib.encodeGas(
            uint128(message.params.gasLimit),
            uint128(message.params.receiverValue)
        );

        // send using wormhole relayer
        uint256 executorFee = msg.value - messageFee;
        executorQuoterRouter.requestExecution{ value: executorFee }(
            wormholeChainId,
            adapterAddress,
            refundAddress,
            quoterAddress,
            requestBytes,
            relayInstructions
        );

        emit SendMessage(bytes32(uint256(sequence)), message);
    }

    function executeVAAv1(bytes memory multiSigVaa) external payable override {
        // skip unused timestamp, nonce, sequence and consistency level
        (, , uint16 emitterChainId, bytes32 emitterAddress, , , bytes memory payload) = CoreBridgeLib
            .decodeAndVerifyVaaMem(address(wormhole), multiSigVaa);

        // check emitter chain and emitter address
        uint16 folksChainId = wormholeChainIdToFolksChainId[emitterChainId];
        (uint16 wormholeChainId, bytes32 adapterAddress) = getChainAdapter(folksChainId);
        if (emitterChainId != wormholeChainId) revert ChainUnavailable(folksChainId);
        if (adapterAddress != emitterAddress) revert InvalidMessageSender(emitterAddress);

        // lib expects single hash but using double hash instead as that's what we are using for message id
        bytes32 vaaHash = VaaLib.calcVaaDoubleHashMem(multiSigVaa);
        HashReplayProtectionLib.replayProtect(vaaHash);

        // decode into metadata and message payload
        (
            WormholeExecutorMessages.WormholeExecutorMetadata memory wormholeExecutorMetadata,
            bytes memory messagePayload
        ) = WormholeExecutorMessages.decodePayloadWithWormholeExecutorMetadata(payload);

        // check that the destination chain is this and sufficient receiver value was passed
        if (wormholeExecutorMetadata.wormholeTargetChainId != thisWormholeChainId)
            revert InvalidTargetChain(wormholeExecutorMetadata.wormholeTargetChainId);
        if (msg.value < wormholeExecutorMetadata.receiverValue)
            revert InsufficientReceiverValue(wormholeExecutorMetadata.receiverValue, msg.value);

        // construct and forward message to bridge router
        Messages.MessageReceived memory messageReceived = Messages.MessageReceived({
            messageId: vaaHash,
            sourceChainId: folksChainId,
            sourceAddress: wormholeExecutorMetadata.messageMetadata.sender,
            handler: wormholeExecutorMetadata.messageMetadata.handler,
            payload: messagePayload,
            returnAdapterId: wormholeExecutorMetadata.messageMetadata.returnAdapterId,
            returnGasLimit: wormholeExecutorMetadata.messageMetadata.returnGasLimit
        });
        bridgeRouter.receiveMessage{ value: msg.value }(messageReceived);

        emit ReceiveMessage(messageReceived.messageId, adapterAddress);
    }

    function setQuoterAddress(address _quoterAddress) external onlyRole(MANAGER_ROLE) {
        quoterAddress = _quoterAddress;
    }

    function setRefundAddress(address _refundAddress) external onlyRole(MANAGER_ROLE) {
        refundAddress = _refundAddress;
    }

    function addChain(
        uint16 folksChainId,
        uint16 wormholeChainId,
        bytes32 adapterAddress
    ) external onlyRole(MANAGER_ROLE) {
        // check if chain is already added
        bool isAvailable = isChainAvailable(folksChainId);
        if (isAvailable) revert ChainAlreadyAdded(folksChainId);

        // add chain
        folksChainIdToWormholeAdapter[folksChainId] = WormholeAdapterParams({
            isAvailable: true,
            wormholeChainId: wormholeChainId,
            adapterAddress: adapterAddress
        });
        wormholeChainIdToFolksChainId[wormholeChainId] = folksChainId;
    }

    function removeChain(uint16 folksChainId) external onlyRole(MANAGER_ROLE) {
        // get chain adapter if available
        (uint16 wormholeChainId, ) = getChainAdapter(folksChainId);

        // remove chain
        delete folksChainIdToWormholeAdapter[folksChainId];
        delete wormholeChainIdToFolksChainId[wormholeChainId];
    }

    function isChainAvailable(uint16 chainId) public view override returns (bool) {
        return folksChainIdToWormholeAdapter[chainId].isAvailable;
    }

    function getChainAdapter(uint16 chainId) public view returns (uint16 wormholeChainId, bytes32 adapterAddress) {
        WormholeAdapterParams memory chainAdapter = folksChainIdToWormholeAdapter[chainId];
        if (!chainAdapter.isAvailable) revert ChainUnavailable(chainId);

        wormholeChainId = chainAdapter.wormholeChainId;
        adapterAddress = chainAdapter.adapterAddress;
    }

    function _checkMessageParamsOverflow(Messages.MessageParams memory params) internal pure {
        if (params.gasLimit > type(uint128).max) revert MessageParamsOverflow(params.gasLimit);
        if (params.receiverValue > type(uint128).max) revert MessageParamsOverflow(params.receiverValue);
    }
}
