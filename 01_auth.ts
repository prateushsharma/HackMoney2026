import "dotenv/config";
import wsPkg from "ws";
import { randomBytes } from "crypto";

import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// nitrolite is CommonJS -> default import
import nitrolite from "@erc7824/nitrolite";
const n = nitrolite as any;

// Robust WebSocket ctor (CJS/ESM)
const WebSocketCtor: any =
  (wsPkg as any).WebSocket ?? (wsPkg as any).default ?? (wsPkg as any);

const WS_URL =
  process.env.CLEARNODE_WS_URL || "wss://clearnet-sandbox.yellow.com/ws";

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const RPC_URL = process.env.ALCHEMY_RPC_URL;

if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in .env (must start with 0x)");
if (!RPC_URL) throw new Error("Missing ALCHEMY_RPC_URL in .env");

// Yellow sandbox addresses (from quickstart)
const CUSTODY = "0x019B65A265EB3363822f2752141b3dF16131b262";
const ADJUDICATOR = "0x7c7ccbc98469190849BCC6c926307794fDfB11F2";

// IMPORTANT: use doc values first (sandbox can be strict)
const APP_NAME = "Test app";
const SCOPE = "test.app";
const ASSET = "ytest.usd";

// Pull only what we need
const {
  NitroliteClient,
  WalletStateSigner,
  createECDSAMessageSigner,
  createAuthRequestMessage,
  createEIP712AuthMessageSigner,
  createAuthVerifyMessageFromChallenge,
} = n;

async function main() {
  // --- main wallet (EOA)
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

  // Not used in Part 1, but kept for later parts
  const _client = new NitroliteClient({
    publicClient,
    walletClient,
    stateSigner: new WalletStateSigner(walletClient),
    addresses: { custody: CUSTODY, adjudicator: ADJUDICATOR },
    chainId: sepolia.id,
    challengeDuration: 3600n,
  });

  console.log("Main wallet:", account.address);
  console.log("WS:", WS_URL);
  console.log("Custody:", CUSTODY);
  console.log("Adjudicator:", ADJUDICATOR);

  // --- session key (temporary)
  const sessionPrivateKey = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  console.log("Session key address:", sessionAccount.address);

  // --- auth request params (docs show expires_at bigint; SDK will encode properly)
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const authParams = {
    address: account.address,
    application: APP_NAME,
    session_key: sessionAccount.address,
    allowances: [{ asset: ASSET, amount: "1000000000" }],
    expires_at: expiresAt,
    scope: SCOPE,
  };

  // Create ws with Origin header (some gateways require this)
  const ws = new WebSocketCtor(WS_URL, {
    headers: { Origin: "https://docs.yellow.org" },
  });

  // If the server rejects upgrade, this prints HTTP status
  ws.on("unexpected-response", (_req: any, res: any) => {
    console.log("UNEXPECTED RESPONSE:", res.statusCode, res.statusMessage);
  });

 ws.on("open", async () => {
  console.log("WS open ✅ sending auth_request...");

  // Try both signatures:
  // vA: createAuthRequestMessage(params)
  // vB: createAuthRequestMessage(sessionSigner, params)
  let authRequestMsg: any;

  try {
    // if function expects signer first
    if (typeof createAuthRequestMessage === "function" && createAuthRequestMessage.length >= 2) {
      authRequestMsg = await createAuthRequestMessage(sessionSigner, authParams);
    } else {
      authRequestMsg = await createAuthRequestMessage(authParams);
    }
  } catch (e) {
    console.error("createAuthRequestMessage failed:", e);
    ws.close();
    return;
  }

  const payload =
    typeof authRequestMsg === "string" ? authRequestMsg : JSON.stringify(authRequestMsg);

  console.log("Outgoing auth_request:", payload);
  ws.send(payload);
});


  ws.on("message", async (raw: any) => {
    try {
      const text = raw.toString();
      const response = JSON.parse(text);

      const type = response.method;
      // Uncomment if you want to see everything:
      // console.log("IN:", JSON.stringify(response));

      if (type === "auth_challenge") {
        console.log("auth_challenge ✅");

        // docs: response.res[2].challenge_message
        const challenge =
          response?.res?.[2]?.challenge_message ??
          response?.params?.challenge_message ??
          response?.result?.challenge_message;

        if (!challenge) {
          console.error("Missing challenge_message. Full response:", response);
          ws.close();
          return;
        }

        // Sign with MAIN wallet (EIP-712)
        const signer = createEIP712AuthMessageSigner(walletClient, authParams, {
          name: APP_NAME,
        });

        const verifyMsg = await createAuthVerifyMessageFromChallenge(signer, challenge);

        const verifyPayload =
          typeof verifyMsg === "string" ? verifyMsg : JSON.stringify(verifyMsg);

        console.log("Outgoing auth_verify:", verifyPayload);
        ws.send(verifyPayload);
        console.log("auth_verify sent ✅");
        return;
      }

      if (type === "auth_verify") {
        console.log("auth_verify response ✅");

        const success =
          response?.res?.[2]?.success ??
          response?.params?.success ??
          response?.result?.success;

        const jwtToken =
          response?.res?.[2]?.jwtToken ??
          response?.params?.jwtToken ??
          response?.result?.jwtToken;

        if (!success) {
          console.error("Auth failed ❌ Full response:", response);
          ws.close();
          return;
        }

        console.log("Auth success ✅");
        if (jwtToken) console.log("JWT:", jwtToken);

        ws.close();
        return;
      }

      if (type === "error") {
        console.error("RPC error ❌", response);
        ws.close();
        return;
      }
    } catch (e: any) {
      console.error("Message handling error:", e?.message || e);
      ws.close();
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    console.log("WS closed ❌", { code, reason: reason?.toString() });
  });

  ws.on("error", (e: any) => console.error("WS error:", e));

  void _client;
  void sessionSigner;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
