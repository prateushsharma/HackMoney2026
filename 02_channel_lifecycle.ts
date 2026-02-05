import "dotenv/config";
import WebSocket from "ws";
import { randomBytes } from "crypto";

import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import {
  NitroliteClient,
  WalletStateSigner,
  createECDSAMessageSigner,
  createAuthRequestMessage,
  createEIP712AuthMessageSigner,
  createAuthVerifyMessageFromChallenge,
  createGetChannelsMessage,
  createCreateChannelMessage,
  createResizeChannelMessage,
  createCloseChannelMessage,
  createGetLedgerBalancesMessage,
} from "@erc7824/nitrolite";

const WS_URL = process.env.CLEARNODE_WS_URL || "wss://clearnet-sandbox.yellow.com/ws";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const RPC_URL = process.env.ALCHEMY_RPC_URL;

if (!PRIVATE_KEY || !RPC_URL) {
  throw new Error("Missing PRIVATE_KEY or ALCHEMY_RPC_URL in .env");
}

// Yellow sandbox constants
const APP_NAME = "Test app";
const SCOPE = "test.app";
const CUSTODY = "0x019B65A265EB3363822f2752141b3dF16131b262";
const ADJUDICATOR = "0x7c7ccbc98469190849BCC6c926307794fDfB11F2";

// Token address from official example (line 299)
const YTEST_USD_TOKEN = "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb";

async function main() {
  // Main wallet
  const account = privateKeyToAccount(PRIVATE_KEY);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    chain: sepolia,
    transport: http(RPC_URL),
    account,
  });

  // Initialize Nitrolite client
  const client = new NitroliteClient({
    publicClient,
    walletClient,
    stateSigner: new WalletStateSigner(walletClient),
    addresses: {
      custody: CUSTODY,
      adjudicator: ADJUDICATOR,
    },
    chainId: sepolia.id,
    challengeDuration: 3600n,
  });

  console.log("Main wallet:", account.address);
  console.log("Custody:", CUSTODY);
  console.log("Adjudicator:", ADJUDICATOR);

  // Session key
  const sessionPrivateKey = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

  console.log("Session key:", sessionAccount.address);

  // Auth params - EXACT format from working 01_auth_official.ts
  const authParams = {
    session_key: sessionAccount.address as `0x${string}`,
    allowances: [{ asset: "ytest.usd", amount: "1000000000" }],
    expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
    scope: "test.app" as const,
  };

  console.log("\n📋 Auth params:");
  console.log("  session_key:", authParams.session_key);
  console.log("  expires_at:", authParams.expires_at.toString());
  console.log("  scope:", authParams.scope);

  const ws = new WebSocket(WS_URL);
  let isAuthenticated = false;
  let currentChannelId: string | null = null;
  let channelCreationInProgress = false;

  ws.on("open", async () => {
    console.log("\n✅ WebSocket connected");

    try {
      const authRequestMsg = await createAuthRequestMessage({
        address: account.address,
        application: APP_NAME,
        ...authParams,
      });

      console.log("\n📤 Sending auth_request:");
      const msgStr = typeof authRequestMsg === "string" ? authRequestMsg : JSON.stringify(authRequestMsg);
      console.log("Message length:", msgStr.length);
      console.log("First 300 chars:", msgStr.substring(0, 300));
      
      // Parse and verify structure
      const parsed = JSON.parse(msgStr);
      console.log("\nStructure check:");
      console.log("- Has 'req'?", "req" in parsed);
      console.log("- Has 'sig'?", "sig" in parsed);
      console.log("- req length:", parsed.req?.length);
      console.log("- req[1] (method):", parsed.req?.[1]);
      console.log("- expires_at type:", typeof parsed.req?.[2]?.expires_at);
      console.log("- scope value:", parsed.req?.[2]?.scope);
      
      ws.send(msgStr);
    } catch (error: any) {
      console.error("❌ Error creating auth request:", error.message);
      console.error(error.stack);
      ws.close();
    }
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const type = msg.res ? msg.res[1] : null;

      // Log ALL messages for debugging
      console.log(`\n📨 Received (raw): ${type || "unknown"}`);

      // Filter background messages (but still log them)
      if (type === "bu" || type === "assets" || type === "cu") {
        console.log("   (background message - filtered)");
        return;
      }

      console.log(`\n📨 Processing: ${type}`);

      // ============ AUTHENTICATION FLOW ============
      if (type === "auth_challenge") {
        if (isAuthenticated) return;

        const challenge = msg.res[2]?.challenge_message;
        if (!challenge) {
          console.error("❌ No challenge");
          ws.close();
          return;
        }

        const signer = createEIP712AuthMessageSigner(walletClient, authParams, {
          name: APP_NAME,
        });

        const verifyMsg = await createAuthVerifyMessageFromChallenge(signer, challenge);
        ws.send(verifyMsg);
      }

      if (type === "auth_verify") {
        const success = msg.res[2]?.success;
        if (!success) {
          console.error("❌ Auth failed");
          ws.close();
          return;
        }

        console.log("🎉 Authentication successful!\n");
        isAuthenticated = true;

        // Start channel flow - get existing channels first
        console.log("📋 Checking for existing channels...");
        const channelsMsg = await createGetChannelsMessage(sessionSigner, account.address);
        ws.send(channelsMsg);
      }

      // ============ CHANNEL FLOW ============

      // Handle get_channels response
      if (type === "channels" || type === "get_channels") {
        const channels = msg.res[2]?.channels || [];
        console.log(`Found ${channels.length} channels`);

        const openChannel = channels.find((c: any) => c.status === "open");

        if (openChannel) {
          currentChannelId = openChannel.channel_id;
          console.log(`\n✅ Found open channel: ${currentChannelId}`);
          
          const amount = BigInt(openChannel.amount || 0);
          console.log(`Channel balance: ${amount}`);

          if (amount >= 20n) {
            console.log("Channel already funded, proceeding to close...");
            await closeChannel(openChannel.channel_id);
          } else {
            console.log("Channel needs funding, triggering resize...");
            await resizeChannel(openChannel.channel_id);
          }
        } else if (!channelCreationInProgress) {
          channelCreationInProgress = true;
          console.log("\n📦 No open channel found, creating new channel...");
          const createMsg = await createCreateChannelMessage(sessionSigner, {
            chain_id: 11155111, // Sepolia
            token: YTEST_USD_TOKEN,
          });
          ws.send(createMsg);
        }
      }

      // Handle create_channel response
      if (type === "create_channel") {
        const { channel_id, channel, state, server_signature } = msg.res[2];
        
        console.log(`\n🏗️  Channel prepared by server:`);
        console.log(`  Channel ID: ${channel_id}`);
        console.log(`  Version: ${state.version}`);

        currentChannelId = channel_id;

        // Prepare unsigned initial state (from official example, line 324)
        const unsignedInitialState = {
          intent: state.intent,
          version: BigInt(state.version),
          data: state.state_data,
          allocations: state.allocations.map((a: any) => ({
            destination: a.destination,
            token: a.token,
            amount: BigInt(a.amount),
          })),
        };

        console.log("\n📝 Creating channel on-chain...");

        try {
          const res = await client.createChannel({
            channel,
            unsignedInitialState,
            serverSignature: server_signature,
          });

          const txHash = typeof res === "string" ? res : res.txHash;
          console.log(`✅ Channel created on-chain: ${txHash}`);

          // Wait for indexing (from official example)
          console.log("\n⏳ Waiting 25s for node to index channel...");
          await new Promise((r) => setTimeout(r, 25000));

          // Now resize to fund it
          await resizeChannel(channel_id);
        } catch (error: any) {
          console.error("❌ Create channel failed:", error.message);
          ws.close();
        }
      }

      // Handle resize_channel response
      if (type === "resize_channel") {
        const { channel_id, state, server_signature } = msg.res[2];
        
        console.log(`\n💰 Channel resize response received`);
        console.log(`  Channel ID: ${channel_id}`);
        console.log(`  Version: ${state.version}`);

        // In official example (line 358), they skip on-chain resize for optimistic execution
        console.log("ℹ️  Using optimistic execution (skipping on-chain resize)");
        
        // Proceed to close
        console.log("\n⏳ Waiting 3s before close...");
        await new Promise((r) => setTimeout(r, 3000));
        await closeChannel(channel_id);
      }

      // Handle close_channel response
      if (type === "close_channel") {
        const { channel_id, state, server_signature } = msg.res[2];
        
        console.log(`\n🔒 Closing channel on-chain...`);

        try {
          const txHash = await client.closeChannel({
            finalState: {
              intent: state.intent,
              version: BigInt(state.version),
              data: state.state_data || state.data,
              allocations: state.allocations.map((a: any) => ({
                destination: a.destination,
                token: a.token,
                amount: BigInt(a.amount),
              })),
              channelId: channel_id,
              serverSignature: server_signature,
            },
            stateData: "0x",
          });

          console.log(`✅ Channel closed on-chain: ${txHash}`);
          console.log("\n🎊 Channel lifecycle complete!");
          
          // Check final balance
          console.log("\n📊 Checking final ledger balance...");
          const balanceMsg = await createGetLedgerBalancesMessage(
            sessionSigner,
            account.address
          );
          ws.send(balanceMsg);
        } catch (error: any) {
          console.error("❌ Close channel failed:", error.message);
          ws.close();
        }
      }

      // Handle get_ledger_balances response
      if (type === "get_ledger_balances") {
        const balances = msg.res[2]?.ledger_balances || [];
        console.log("\n💼 Final Ledger Balances:");
        balances.forEach((b: any) => {
          console.log(`  ${b.asset}: ${b.amount}`);
        });

        console.log("\n✅ Demo complete! Closing connection...");
        setTimeout(() => ws.close(), 2000);
      }

      // Handle errors
      if (type === "error") {
        console.error("\n❌ Error from server:");
        console.error(JSON.stringify(msg.res[2], null, 2));
      }
    } catch (e: any) {
      console.error("❌ Message handling error:", e.message);
    }
  });

  ws.on("close", (code) => {
    console.log(`\n🔌 WebSocket closed: ${code}`);
  });

  ws.on("error", (e: any) => {
    console.error("❌ WebSocket error:", e.message);
  });

  // Helper functions
  async function resizeChannel(channelId: string) {
    console.log(`\n💸 Triggering resize for channel ${channelId}...`);
    const resizeMsg = await createResizeChannelMessage(sessionSigner, {
      channel_id: channelId as `0x${string}`,
      allocate_amount: 20n, // Allocate from unified balance
      funds_destination: account.address,
    });
    ws.send(resizeMsg);
  }

  async function closeChannel(channelId: string) {
    console.log(`\n🔐 Requesting channel close for ${channelId}...`);
    const closeMsg = await createCloseChannelMessage(
      sessionSigner,
      channelId as `0x${string}`,
      account.address
    );
    ws.send(closeMsg);
  }
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});