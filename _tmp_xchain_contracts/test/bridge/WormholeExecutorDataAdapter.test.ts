import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterSender__factory,
  MockWormhole__factory,
  MockExecutorQuoterRouter__factory,
  WormholeExecutorDataAdapter__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  convertNumberToBytes,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
  MAX_UINT128,
  UINT16_LENGTH,
  UINT256_LENGTH,
} from "../utils/bytes";
import { encodeGas, encodeVaaMultiSigRequest } from "../utils/messages/executor";
import { Finality, MessageParams, MessageToSend, buildMessagePayload } from "../utils/messages/messages";
import { encodeWormholeVAA } from "../utils/messages/wormhole";
import { encodePayloadWithWormholeExecutorMetadata } from "../utils/messages/wormholeExecutorMessages";
import { SECONDS_IN_DAY, getLatestBlockTimestamp, getRandomInt } from "../utils/time";
import { WormholeFinality } from "../utils/wormhole";

describe("WormholeExecutorDataAdapter (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const MANAGER_ROLE = ethers.keccak256(convertStringToBytes("MANAGER"));

  const WH_CHAIN_ID = 2;
  const GUARDIAN = ethers.Wallet.createRandom();

  const getMessageParams = (): MessageParams => ({
    adapterId: BigInt(0),
    receiverValue: BigInt(0.1e18),
    gasLimit: BigInt(500_000),
    returnAdapterId: BigInt(0),
    returnGasLimit: BigInt(0),
  });

  const getMessage = (destChainId: number): MessageToSend => ({
    params: getMessageParams(),
    sender: convertEVMAddressToGenericAddress(getRandomAddress()),
    destinationChainId: BigInt(destChainId),
    handler: convertEVMAddressToGenericAddress(getRandomAddress()),
    payload: buildMessagePayload(0, getAccountIdBytes("ACCOUNT_ID"), getRandomAddress(), "0x"),
    finalityLevel: Finality.IMMEDIATE,
    extraArgs: "0x",
  });

  async function deployWormholeExecutorDataAdapterFixture() {
    const [user, admin, ...unusedUsers] = await ethers.getSigners();

    // deploy mock wormhole core
    const wormhole = await new MockWormhole__factory(admin).deploy();
    await wormhole.setChainId(WH_CHAIN_ID);
    await wormhole.setGuardianSet({
      keys: [GUARDIAN.address],
      expirationTime: (await getLatestBlockTimestamp()) + SECONDS_IN_DAY,
    });

    // deploy adapter
    const executorQuoterRouter = await new MockExecutorQuoterRouter__factory(admin).deploy();
    const bridgeRouter = await new BridgeRouterSender__factory(admin).deploy();
    const quoterAddress = getRandomAddress();
    const refundAddress = getRandomAddress();
    const adapter = await new WormholeExecutorDataAdapter__factory(user).deploy(
      admin,
      wormhole,
      executorQuoterRouter,
      bridgeRouter,
      quoterAddress,
      refundAddress
    );
    await bridgeRouter.setAdapter(adapter);

    return {
      user,
      admin,
      unusedUsers,
      adapter,
      wormhole,
      executorQuoterRouter,
      bridgeRouter,
      quoterAddress,
      refundAddress,
    };
  }

  async function addChainFixture() {
    const {
      user,
      admin,
      unusedUsers,
      adapter,
      wormhole,
      executorQuoterRouter,
      bridgeRouter,
      quoterAddress,
      refundAddress,
    } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

    // add chain
    const corrFolksChainId = 0;
    const corrWormholeChainId = 5;
    const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());
    await adapter.connect(admin).addChain(corrFolksChainId, corrWormholeChainId, corrAdapterAddress);

    return {
      user,
      admin,
      unusedUsers,
      adapter,
      wormhole,
      executorQuoterRouter,
      bridgeRouter,
      quoterAddress,
      refundAddress,
      corrFolksChainId,
      corrWormholeChainId,
      corrAdapterAddress,
    };
  }

  describe("Deployment", () => {
    it("Should set admin, relayer and bridge router correctly", async () => {
      const { admin, adapter, wormhole, executorQuoterRouter, bridgeRouter, quoterAddress, refundAddress } =
        await loadFixture(deployWormholeExecutorDataAdapterFixture);

      // check default admin role
      expect(await adapter.owner()).to.equal(admin.address);
      expect(await adapter.defaultAdmin()).to.equal(admin.address);
      expect(await adapter.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await adapter.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await adapter.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check manager role
      expect(await adapter.getRoleAdmin(MANAGER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await adapter.hasRole(MANAGER_ROLE, admin.address)).to.be.true;

      // check state
      expect(await adapter.wormhole()).to.equal(wormhole);
      expect(await adapter.thisWormholeChainId()).to.equal(WH_CHAIN_ID);
      expect(await adapter.executorQuoterRouter()).to.equal(executorQuoterRouter);
      expect(await adapter.bridgeRouter()).to.equal(bridgeRouter);
      expect(await adapter.quoterAddress()).to.equal(quoterAddress);
      expect(await adapter.refundAddress()).to.equal(refundAddress);
    });
  });

  describe("Set Quoter Address", () => {
    it("Should successfully set quoter address", async () => {
      const { admin, adapter } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

      // set quoter address
      const quoterAddress = getRandomAddress();
      await adapter.connect(admin).setQuoterAddress(quoterAddress);
      expect(await adapter.quoterAddress()).to.equal(quoterAddress);
    });

    it("Should fail to set quoter address when sender is not manager", async () => {
      const { user, adapter } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

      const quoterAddress = getRandomAddress();

      // set refund address
      const setQuoterAddress = adapter.connect(user).setQuoterAddress(quoterAddress);
      await expect(setQuoterAddress)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });
  });

  describe("Set Refund Address", () => {
    it("Should successfully set refund address", async () => {
      const { admin, adapter } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

      // set refund address
      const refundAddress = getRandomAddress();
      await adapter.connect(admin).setRefundAddress(refundAddress);
      expect(await adapter.refundAddress()).to.equal(refundAddress);
    });

    it("Should fail to set refund address when sender is not manager", async () => {
      const { user, adapter } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

      const refundAddress = getRandomAddress();

      // set refund address
      const setRefundAddress = adapter.connect(user).setRefundAddress(refundAddress);
      await expect(setRefundAddress)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });
  });

  describe("Add Chain", () => {
    it("Should successfully add chain", async () => {
      const { adapter, corrFolksChainId, corrWormholeChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // verfy added
      expect(await adapter.isChainAvailable(corrFolksChainId)).to.be.true;
      expect(await adapter.getChainAdapter(corrFolksChainId)).to.be.eql([
        BigInt(corrWormholeChainId),
        corrAdapterAddress,
      ]);
    });

    it("Should fail to add chain when sender is not manager", async () => {
      const { user, adapter } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

      const folksChainId = 0;
      const wormholeChainId = 5;
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());

      // add chain
      const addChain = adapter.connect(user).addChain(folksChainId, wormholeChainId, corrAdapterAddress);
      await expect(addChain)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });

    it("Should fail to add chain when already added", async () => {
      const { admin, adapter, corrFolksChainId } = await loadFixture(addChainFixture);

      const corrWormholeChainId = 3;
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());

      // verify added
      expect(await adapter.isChainAvailable(corrFolksChainId)).to.be.true;

      // add chain
      const addChain = adapter.connect(admin).addChain(corrFolksChainId, corrWormholeChainId, corrAdapterAddress);
      await expect(addChain).to.be.revertedWithCustomError(adapter, "ChainAlreadyAdded").withArgs(corrFolksChainId);
    });
  });

  describe("Remove Chain", () => {
    it("Should successfully remove chain", async () => {
      const { admin, adapter, corrFolksChainId } = await loadFixture(addChainFixture);

      // remove chain
      await adapter.connect(admin).removeChain(corrFolksChainId);
      expect(await adapter.isChainAvailable(corrFolksChainId)).to.be.false;
    });

    it("Should fail to remove chain when sender is not manager", async () => {
      const { user, adapter, corrFolksChainId } = await loadFixture(addChainFixture);

      // remove chain
      const removeChain = adapter.connect(user).removeChain(corrFolksChainId);
      await expect(removeChain)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });

    it("Should fail to remove chain when not added", async () => {
      const { admin, adapter } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

      // verify not added
      const folksChainId = 0;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;

      // add chain
      const removeChain = adapter.connect(admin).removeChain(folksChainId);
      await expect(removeChain).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });
  });

  describe("Get Chain Adapter", () => {
    it("Should fail when chain not added", async () => {
      const { admin, adapter } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

      // verify not added
      const corrFolksChainId = 0;
      expect(await adapter.isChainAvailable(corrFolksChainId)).to.be.false;

      // get chain adapter
      const getChainAdapter = adapter.connect(admin).getChainAdapter(corrFolksChainId);
      await expect(getChainAdapter)
        .to.be.revertedWithCustomError(adapter, "ChainUnavailable")
        .withArgs(corrFolksChainId);
    });
  });

  describe("Get Send Fee", () => {
    it("Should successfully get send fee", async () => {
      const { adapter, wormhole, executorQuoterRouter, corrFolksChainId } = await loadFixture(addChainFixture);

      // set publish fee
      const publishFee = BigInt(getRandomInt(100_000));
      await wormhole.setMessageFee(publishFee);

      // set executor fee
      const executorFee = BigInt(getRandomInt(500_000));
      await executorQuoterRouter.setExecutorFee(executorFee);

      // get send fee
      const message = getMessage(corrFolksChainId);
      const fee = await adapter.getSendFee(message);
      expect(fee).to.be.equal(publishFee + executorFee);
    });

    it("Should fail to get send fee when message params gas limit overflows", async () => {
      const { adapter, corrFolksChainId } = await loadFixture(addChainFixture);

      const message = getMessage(corrFolksChainId);
      const gasLimit = MAX_UINT128 + BigInt(1);
      message.params.gasLimit = gasLimit;

      const getSendFee = adapter.getSendFee(message);
      await expect(getSendFee).to.be.revertedWithCustomError(adapter, "MessageParamsOverflow").withArgs(gasLimit);
    });

    it("Should fail to get send fee when message params receiver value overflows", async () => {
      const { adapter, corrFolksChainId } = await loadFixture(addChainFixture);

      const message = getMessage(corrFolksChainId);
      const receiverValue = MAX_UINT128 + BigInt(1);
      message.params.receiverValue = receiverValue;

      const getSendFee = adapter.getSendFee(message);
      await expect(getSendFee).to.be.revertedWithCustomError(adapter, "MessageParamsOverflow").withArgs(receiverValue);
    });

    it("Should fail to get send fee when chain not added", async () => {
      const { adapter } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

      // verify not added
      const folksChainId = 0;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;
      const message = getMessage(folksChainId);

      // get send fee
      const getSendFee = adapter.getSendFee(message);
      await expect(getSendFee).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });
  });

  describe("Send Message", () => {
    it("Should successfully send immediate finality message", async () => {
      const {
        adapter,
        wormhole,
        executorQuoterRouter,
        bridgeRouter,
        quoterAddress,
        refundAddress,
        corrFolksChainId,
        corrWormholeChainId,
        corrAdapterAddress,
      } = await loadFixture(addChainFixture);

      // balances before
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const wormholeBalance = await ethers.provider.getBalance(wormhole);
      const executorQuoterRouterBalance = await ethers.provider.getBalance(executorQuoterRouter);

      // get fee
      const message = getMessage(corrFolksChainId);
      message.finalityLevel = Finality.IMMEDIATE;
      const totalFee = await bridgeRouter.getSendFee(message);
      const publishFee = await wormhole.messageFee();
      const executorFee = totalFee - publishFee;

      // set sequence
      const sequence = getRandomInt(1000);
      await wormhole.setSequence(sequence);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: totalFee });
      await expect(sendMessage)
        .to.emit(adapter, "SendMessage")
        .withArgs(convertNumberToBytes(sequence, BYTES32_LENGTH), anyValue);
      await expect(sendMessage)
        .to.emit(wormhole, "PublishMessage")
        .withArgs(
          publishFee,
          0,
          encodePayloadWithWormholeExecutorMetadata(corrWormholeChainId, message),
          WormholeFinality.INSTANT
        );
      await expect(sendMessage)
        .to.emit(executorQuoterRouter, "RequestExecution")
        .withArgs(
          executorFee,
          corrWormholeChainId,
          corrAdapterAddress,
          refundAddress,
          quoterAddress,
          encodeVaaMultiSigRequest(
            WH_CHAIN_ID,
            convertEVMAddressToGenericAddress(await adapter.getAddress()),
            sequence
          ),
          encodeGas(message.params.gasLimit, message.params.receiverValue)
        );

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(wormhole)).to.equal(wormholeBalance + publishFee);
      expect(await ethers.provider.getBalance(executorQuoterRouter)).to.equal(
        executorQuoterRouterBalance + executorFee
      );
    });

    it("Should successfully send finalised finality message", async () => {
      const {
        adapter,
        wormhole,
        executorQuoterRouter,
        bridgeRouter,
        quoterAddress,
        refundAddress,
        corrFolksChainId,
        corrWormholeChainId,
        corrAdapterAddress,
      } = await loadFixture(addChainFixture);

      // get fee
      const message = getMessage(corrFolksChainId);
      message.finalityLevel = Finality.FINALISED;
      const totalFee = await bridgeRouter.getSendFee(message);
      const publishFee = await wormhole.messageFee();
      const executorFee = totalFee - publishFee;

      // set sequence
      const sequence = getRandomInt(1000);
      await wormhole.setSequence(sequence);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: totalFee });
      await expect(sendMessage)
        .to.emit(adapter, "SendMessage")
        .withArgs(convertNumberToBytes(sequence, BYTES32_LENGTH), anyValue);
      await expect(sendMessage)
        .to.emit(wormhole, "PublishMessage")
        .withArgs(
          publishFee,
          0,
          encodePayloadWithWormholeExecutorMetadata(corrWormholeChainId, message),
          WormholeFinality.FINALIZED
        );
      await expect(sendMessage)
        .to.emit(executorQuoterRouter, "RequestExecution")
        .withArgs(
          executorFee,
          corrWormholeChainId,
          corrAdapterAddress,
          refundAddress,
          quoterAddress,
          encodeVaaMultiSigRequest(
            WH_CHAIN_ID,
            convertEVMAddressToGenericAddress(await adapter.getAddress()),
            sequence
          ),
          encodeGas(message.params.gasLimit, message.params.receiverValue)
        );
    });

    it("Should fail to send message when sender is not bridge router", async () => {
      const { user, adapter, corrFolksChainId } = await loadFixture(addChainFixture);

      // get fee
      const message = getMessage(corrFolksChainId);
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = adapter.connect(user).sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "InvalidBridgeRouter").withArgs(user.address);
    });

    it("Should fail to send message when chain not added", async () => {
      const { adapter, bridgeRouter } = await loadFixture(deployWormholeExecutorDataAdapterFixture);

      // verify not added
      const corrFolksChainId = 0;
      expect(await adapter.isChainAvailable(corrFolksChainId)).to.be.false;

      // get fee
      const message = getMessage(corrFolksChainId);
      const fee = 10000;

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(corrFolksChainId);
    });

    it("Should fail to send message when message params gas limit overflows", async () => {
      const { adapter, bridgeRouter, corrFolksChainId } = await loadFixture(addChainFixture);

      const message = getMessage(corrFolksChainId);
      const gasLimit = MAX_UINT128 + BigInt(1);
      message.params.gasLimit = gasLimit;

      const sendMessage = bridgeRouter.sendMessage(message);
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "MessageParamsOverflow").withArgs(gasLimit);
    });

    it("Should fail to send message when message params receiver value overflows", async () => {
      const { adapter, bridgeRouter, corrFolksChainId } = await loadFixture(addChainFixture);

      const message = getMessage(corrFolksChainId);
      const receiverValue = MAX_UINT128 + BigInt(1);
      message.params.receiverValue = receiverValue;

      const sendMessage = bridgeRouter.sendMessage(message);
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "MessageParamsOverflow").withArgs(receiverValue);
    });

    it("Should fail to send message when extra args is used", async () => {
      const { adapter, bridgeRouter, corrFolksChainId } = await loadFixture(addChainFixture);

      // get fee
      const message = getMessage(corrFolksChainId);
      message.extraArgs = "0x00";
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "UnsupportedExtraArgs");
    });
  });

  describe("Execute VAA v1", () => {
    it("Should successfully receive message", async () => {
      const { adapter, bridgeRouter, corrFolksChainId, corrWormholeChainId, corrAdapterAddress } =
        await loadFixture(addChainFixture);

      // balances before
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);

      // construct message
      const message = getMessage(corrFolksChainId);
      const receiverValue = BigInt(getRandomInt(1e18));
      message.params.receiverValue = receiverValue;
      const { digest, vaa } = encodeWormholeVAA(
        GUARDIAN,
        corrWormholeChainId,
        corrAdapterAddress,
        getRandomInt(1000),
        WormholeFinality.FINALIZED,
        encodePayloadWithWormholeExecutorMetadata(WH_CHAIN_ID, message)
      );

      // receive message
      const receiveMessage = adapter.executeVAAv1(vaa, { value: receiverValue });
      await expect(receiveMessage)
        .to.emit(adapter, "ReceiveMessage(bytes32,bytes32)")
        .withArgs(digest, corrAdapterAddress);
      await expect(receiveMessage)
        .to.emit(bridgeRouter, "MessageReceived")
        .withArgs(
          Object.values([
            digest,
            convertNumberToBytes(corrFolksChainId, UINT16_LENGTH),
            message.sender,
            message.handler,
            message.payload,
            convertNumberToBytes(message.params.returnAdapterId, UINT16_LENGTH),
            convertNumberToBytes(message.params.returnGasLimit, UINT256_LENGTH),
          ])
        );

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(bridgeRouterBalance + receiverValue);
    });

    it("Should fail to receive message when vaa version is not 1", async () => {
      const { adapter, corrFolksChainId, corrWormholeChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // construct message
      const message = getMessage(corrFolksChainId);
      const vaaVersion = 2;
      const { vaa } = encodeWormholeVAA(
        GUARDIAN,
        corrWormholeChainId,
        corrAdapterAddress,
        getRandomInt(1000),
        WormholeFinality.FINALIZED,
        encodePayloadWithWormholeExecutorMetadata(WH_CHAIN_ID, message),
        vaaVersion
      );

      // receive message
      const receiveMessage = adapter.executeVAAv1(vaa);
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "UnexpectedVersion").withArgs(vaaVersion);
    });

    it("Should fail to receive message when insufficient number of guardian signatures", async () => {
      const { adapter, corrFolksChainId, corrWormholeChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // construct message
      const message = getMessage(corrFolksChainId);
      const { vaa } = encodeWormholeVAA(
        GUARDIAN,
        corrWormholeChainId,
        corrAdapterAddress,
        getRandomInt(1000),
        WormholeFinality.FINALIZED,
        encodePayloadWithWormholeExecutorMetadata(WH_CHAIN_ID, message),
        undefined,
        true
      );

      // receive message
      const receiveMessage = adapter.executeVAAv1(vaa);
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "VerificationFailed");
    });

    it("Should fail to receive message when guardian signature is invalid", async () => {
      const { adapter, corrFolksChainId, corrWormholeChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // construct message
      const message = getMessage(corrFolksChainId);
      const { vaa } = encodeWormholeVAA(
        GUARDIAN,
        corrWormholeChainId,
        corrAdapterAddress,
        getRandomInt(1000),
        WormholeFinality.FINALIZED,
        encodePayloadWithWormholeExecutorMetadata(WH_CHAIN_ID, message),
        undefined,
        false,
        true
      );

      // receive message
      const receiveMessage = adapter.executeVAAv1(vaa);
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "VerificationFailed");
    });

    it("Should fail to receive message when chain when not added", async () => {
      const { adapter, corrFolksChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // verify chain unknown
      const corrWormholeChainId = 4;
      expect((await adapter.getChainAdapter(corrFolksChainId))[0]).to.not.equal(corrWormholeChainId);

      // construct message
      const message = getMessage(corrFolksChainId);
      const { vaa } = encodeWormholeVAA(
        GUARDIAN,
        corrWormholeChainId,
        corrAdapterAddress,
        getRandomInt(1000),
        WormholeFinality.FINALIZED,
        encodePayloadWithWormholeExecutorMetadata(WH_CHAIN_ID, message)
      );

      // receive message
      const receiveMessage = adapter.executeVAAv1(vaa, { value: message.params.receiverValue });
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "ChainUnavailable")
        .withArgs(corrFolksChainId);
    });

    it("Should fail to receive message when message sender is not corresponding adapter", async () => {
      const { adapter, corrFolksChainId, corrWormholeChainId } = await loadFixture(addChainFixture);

      // verify sender unknown
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      expect((await adapter.getChainAdapter(corrFolksChainId))[1]).to.not.equal(corrAdapterAddress);

      // construct message
      const message = getMessage(corrFolksChainId);
      const { vaa } = encodeWormholeVAA(
        GUARDIAN,
        corrWormholeChainId,
        corrAdapterAddress,
        getRandomInt(1000),
        WormholeFinality.FINALIZED,
        encodePayloadWithWormholeExecutorMetadata(WH_CHAIN_ID, message)
      );

      // receive message
      const receiveMessage = adapter.executeVAAv1(vaa, { value: message.params.receiverValue });
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidMessageSender")
        .withArgs(corrAdapterAddress);
    });

    it("Should fail to receive message already processed", async () => {
      const { adapter, corrFolksChainId, corrWormholeChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // construct message
      const message = getMessage(corrFolksChainId);
      const { vaa } = encodeWormholeVAA(
        GUARDIAN,
        corrWormholeChainId,
        corrAdapterAddress,
        getRandomInt(1000),
        WormholeFinality.FINALIZED,
        encodePayloadWithWormholeExecutorMetadata(WH_CHAIN_ID, message)
      );

      // receive message twice
      await adapter.executeVAAv1(vaa, { value: message.params.receiverValue });
      const receiveMessage = adapter.executeVAAv1(vaa, { value: message.params.receiverValue });
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "AlreadyProcessed");
    });

    it("Should fail to receive message intended for different chain", async () => {
      const { adapter, corrFolksChainId, corrWormholeChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // verify incorrect target chain
      const emitterChainId = 42;
      expect(await adapter.thisWormholeChainId()).to.not.equal(emitterChainId);

      // construct message
      const message = getMessage(corrFolksChainId);
      const { vaa } = encodeWormholeVAA(
        GUARDIAN,
        corrWormholeChainId,
        corrAdapterAddress,
        getRandomInt(1000),
        WormholeFinality.FINALIZED,
        encodePayloadWithWormholeExecutorMetadata(emitterChainId, message)
      );

      // receive message
      const receiveMessage = adapter.executeVAAv1(vaa, { value: message.params.receiverValue });
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidTargetChain")
        .withArgs(emitterChainId);
    });

    it("Should fail to receive message with insufficient receiver value", async () => {
      const { adapter, corrFolksChainId, corrWormholeChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // construct message
      const message = getMessage(corrFolksChainId);
      const receiverValue = BigInt(getRandomInt(1e18));
      message.params.receiverValue = receiverValue;
      const { vaa } = encodeWormholeVAA(
        GUARDIAN,
        corrWormholeChainId,
        corrAdapterAddress,
        getRandomInt(1000),
        WormholeFinality.FINALIZED,
        encodePayloadWithWormholeExecutorMetadata(WH_CHAIN_ID, message)
      );

      // receive message
      const receiveMessage = adapter.executeVAAv1(vaa, { value: receiverValue - BigInt(1) });
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InsufficientReceiverValue")
        .withArgs(receiverValue, receiverValue - BigInt(1));
    });
  });
});
