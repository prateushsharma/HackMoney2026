import "dotenv/config";
import WebSocket from "ws";
import { randomBytes } from "crypto";

import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import {
  createECDSAMessageSigner,
  createAuthRequestMessage,
  createEIP712AuthMessageSigner,
  createAuthVerifyMessageFromChallenge,
} from "@erc7824/nitrolite";

const WS_URL = process.env.CLEARNODE_WS_URL || "wss://clearnet-sandbox.yellow.com/ws";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const RPC_URL = process.env.ALCHEMY_RPC_URL;

if (!PRIVATE_KEY || !RPC_URL) {
  throw new Error("Missing PRIVATE_KEY or ALCHEMY_RPC_URL in .env");
}

// Constants from official example
const APP_NAME = "Test app";
const SCOPE = "test.app"; // ← Official example uses "test.app", not "console"!
const ASSET = "ytest.usd";

async function main() {
  // Main wallet
  const account = privateKeyToAccount(PRIVATE_KEY);

  const walletClient = createWalletClient({
    chain: sepolia,
    transport: http(RPC_URL),
    account,
  });

  console.log("Main wallet:", account.address);
  console.log("WS:", WS_URL);

  // Session key (temporary signing key)
  const sessionPrivateKey = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

  console.log("Session key:", sessionAccount.address);

  // CRITICAL: expires_at is BigInt, NOT string!
  // This is from the official example (line 120)
  const authParams = {
    session_key: sessionAccount.address as `0x${string}`,
    allowances: [{ asset: ASSET, amount: "1000000000" }],
    expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600), // ← BigInt!
    scope: SCOPE,
  };

  console.log("\n📋 Auth params:");
  console.log("  address:", account.address);
  console.log("  session_key:", authParams.session_key);
  console.log("  expires_at:", authParams.expires_at.toString());
  console.log("  scope:", authParams.scope);

  const ws = new WebSocket(WS_URL);
  let isAuthenticated = false;

  ws.on("open", async () => {
    console.log("\n✅ WebSocket connected");

    try {
      // Create auth request - exactly as in official example (line 124)
      const authRequestMsg = await createAuthRequestMessage({
        address: account.address,
        application: APP_NAME,
        ...authParams,
      });

      console.log("\n📤 Sending auth_request...");
      console.log(authRequestMsg);

      ws.send(authRequestMsg);
    } catch (e: any) {
      console.error("❌ Error creating auth_request:", e.message);
      ws.close();
    }
  });

  ws.on("message", async (data) => {
    try {
      const response = JSON.parse(data.toString());
      const type = response.res ? response.res[1] : null;

      // Filter out background updates (BU messages)
      if (type === "bu" || type === "assets") {
        console.log(`ℹ️  Background message: ${type}`);
        return;
      }

      console.log(`\n📨 Received: ${type || "unknown"}`);

      // Handle auth_challenge
      if (type === "auth_challenge") {
        if (isAuthenticated) return;

        console.log("✅ Received auth_challenge");

        const challenge = response.res[2]?.challenge_message;
        if (!challenge) {
          console.error("❌ No challenge_message found");
          console.log("Full response:", JSON.stringify(response, null, 2));
          ws.close();
          return;
        }

        console.log("Challenge:", challenge);

        // Create EIP-712 signer - exactly as in official example (line 142)
        const signer = createEIP712AuthMessageSigner(
          walletClient,
          authParams,
          { name: APP_NAME }
        );

        console.log("\n🔏 Signing challenge with EIP-712...");

        // Create auth_verify - exactly as in official example (line 143)
        const verifyMsg = await createAuthVerifyMessageFromChallenge(signer, challenge);

        console.log("\n📤 Sending auth_verify...");
        ws.send(verifyMsg);
      }

      // Handle auth_verify response
      if (type === "auth_verify") {
        console.log("\n✅ Received auth_verify response");

        const success = response.res[2]?.success;
        const jwtToken = response.res[2]?.jwtToken;

        if (!success) {
          console.error("❌ Authentication failed");
          console.log("Response:", JSON.stringify(response, null, 2));
          ws.close();
          return;
        }

        console.log("\n🎉 Authentication successful!");
        if (jwtToken) {
          console.log("🔑 JWT Token received:", jwtToken.substring(0, 50) + "...");
        }

        isAuthenticated = true;

        // Keep connection open for a moment to verify
        setTimeout(() => {
          console.log("\n✅ Closing connection...");
          ws.close();
        }, 2000);
      }

      // Handle errors
      if (type === "error") {
        console.error("\n❌ Error from server:");
        console.error(JSON.stringify(response.res[2], null, 2));
        ws.close();
      }
    } catch (e: any) {
      console.error("❌ Message handling error:", e.message);
      console.error("Stack:", e.stack);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(
      `\n🔌 WebSocket closed: ${code} ${reason?.toString() || ""}`
    );
    if (code === 1000) {
      console.log("✅ Normal closure");
    } else if (code === 1006) {
      console.log("❌ Abnormal closure - connection rejected by server");
    }
  });

  ws.on("error", (e: any) => {
    console.error("❌ WebSocket error:", e.message);
  });
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});