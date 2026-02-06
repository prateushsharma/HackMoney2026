import "dotenv/config";
import express from "express";
import WebSocket from "ws";
import { randomBytes } from "crypto";

import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import {
  // auth
  createECDSAMessageSigner,
  createAuthRequestMessage,
  createEIP712AuthMessageSigner,
  createAuthVerifyMessageFromChallenge,

  // ledger
  createGetLedgerBalancesMessage,

  // app sessions (protocol core)
  createAppSessionMessage,
  createSubmitAppStateMessage,
  createCloseAppSessionMessage,
} from "@erc7824/nitrolite";

type Hex = `0x${string}`;

const WS_URL = (process.env.CLEARNODE_WS_URL ||
  "wss://clearnet-sandbox.yellow.com/ws") as string;

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
const RPC_URL = process.env.ALCHEMY_RPC_URL as string | undefined;

if (!PRIVATE_KEY || !RPC_URL) {
  throw new Error("Missing PRIVATE_KEY or ALCHEMY_RPC_URL in .env");
}

// Keep these exactly like your working scripts (sandbox)
const APP_NAME = (process.env.YELLOW_APP_NAME || "Test app") as string;
const SCOPE = (process.env.YELLOW_SCOPE || "test.app") as string;
const ASSET = (process.env.YELLOW_ASSET || "ytest.usd") as string;
const ALLOWANCE_AMOUNT = (process.env.YELLOW_ALLOWANCE_AMOUNT || "1000000000") as string;

// --------------------
// Yellow Server State
// --------------------
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

let ws: WebSocket | null = null;

// Session key is held by server (this is “server mode”)
let sessionPrivateKey: Hex | null = null;
let sessionSigner: any = null;
let sessionKeyAddress: Hex | null = null;

// auth state
let isAuthed = false;
let jwtToken: string | undefined;

// pending map to do request/response routing by req[0] / res[0]
const pending = new Map<
  number,
  { resolve: (m: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }
>();

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function ensureWs() {
  if (!ws) throw new Error("WS not connected. Call POST /yellow/connect first.");
}

function ensureAuthed() {
  if (!isAuthed) throw new Error("Not authenticated. Call POST /yellow/auth first.");
}

async function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(WS_URL);

  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ignore background noise
    const t = msg?.res?.[1];
    if (t === "bu" || t === "assets" || t === "cu") return;

    const id = msg?.res?.[0];
    if (typeof id === "number" && pending.has(id)) {
      const p = pending.get(id)!;
      clearTimeout(p.timer);
      pending.delete(id);
      p.resolve(msg);
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws!.once("open", () => resolve());
    ws!.once("error", (e) => reject(e));
  });
}

function sendAndWait(msgStr: string, timeoutMs = 20000): Promise<any> {
  ensureWs();

  const parsed = JSON.parse(msgStr);
  const id = parsed?.req?.[0];
  if (typeof id !== "number") throw new Error("sendAndWait: req[0] missing");

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout waiting for response id=${id}`));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });
    ws!.send(msgStr);
  });
}

function resetSessionKey() {
  sessionPrivateKey = ("0x" + randomBytes(32).toString("hex")) as Hex;
  sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
  sessionKeyAddress = privateKeyToAccount(sessionPrivateKey).address as Hex;
}

// --------------------
// Yellow Actions
// --------------------
async function doAuth() {
  ensureWs();

  if (!sessionPrivateKey || !sessionSigner || !sessionKeyAddress) {
    resetSessionKey();
  }

  const authParams = {
    session_key: sessionKeyAddress as Hex,
    allowances: [{ asset: ASSET, amount: ALLOWANCE_AMOUNT }],
    expires_at: BigInt(nowSec() + 3600),
    scope: SCOPE,
  };

  // 1) auth_request
  const authReq = await createAuthRequestMessage({
    address: account.address,
    application: APP_NAME,
    ...authParams,
  });

  const authReqStr = typeof authReq === "string" ? authReq : JSON.stringify(authReq);
  const challengeRes = await sendAndWait(authReqStr);

  if (challengeRes?.res?.[1] !== "auth_challenge") {
    throw new Error(`Expected auth_challenge, got ${challengeRes?.res?.[1]}`);
  }

  const challenge = challengeRes?.res?.[2]?.challenge_message;
  if (!challenge) throw new Error("Missing challenge_message");

  // 2) auth_verify
  const signer = createEIP712AuthMessageSigner(walletClient, authParams, {
    name: APP_NAME,
  });

  const verify = await createAuthVerifyMessageFromChallenge(signer, challenge);
  const verifyStr = typeof verify === "string" ? verify : JSON.stringify(verify);
  const verifyRes = await sendAndWait(verifyStr);

  if (verifyRes?.res?.[1] !== "auth_verify") {
    throw new Error(`Expected auth_verify, got ${verifyRes?.res?.[1]}`);
  }

  const success = verifyRes?.res?.[2]?.success;
  if (!success) throw new Error(`Auth failed: ${JSON.stringify(verifyRes?.res?.[2])}`);

  jwtToken = verifyRes?.res?.[2]?.jwtToken;
  isAuthed = true;

  return {
    address: account.address,
    session_key: sessionKeyAddress,
    jwtToken: jwtToken ? jwtToken.slice(0, 40) + "..." : undefined,
    app: APP_NAME,
    scope: SCOPE,
    ws: WS_URL,
  };
}

async function getLedgerBalances() {
  ensureWs();
  ensureAuthed();
  const msg = await createGetLedgerBalancesMessage(sessionSigner, account.address);
  const res = await sendAndWait(msg);
  if (res?.res?.[1] !== "get_ledger_balances") {
    throw new Error(`Expected get_ledger_balances, got ${res?.res?.[1]}`);
  }
  return res?.res?.[2]?.ledger_balances ?? [];
}

/**
 * This is your protocol primitive:
 * create app session -> commit -> finalize -> close
 *
 * You can plug Telegram orderbook/solver later.
 */
async function runRWASwapSession(params: {
  seller?: Hex;
  provider: Hex;
  buyers: Hex[];
  // USDC-only netting example (replace with solver later)
  sellerGets: bigint;
  providerFee: bigint;
}) {
  ensureWs();
  ensureAuthed();

  const seller = (params.seller || (account.address as Hex)) as Hex;
  const provider = params.provider;
  const buyers = params.buyers;

  // participants: seller + provider + all buyers
  const participants: Hex[] = [seller, provider, ...buyers];

  // 1) create app session
  const createMsg = await createAppSessionMessage(sessionSigner, [
    {
      definition: {
        protocol: "nitroliterpc",
        participants,
        weights: new Array(participants.length).fill(1),
        quorum: participants.length, // strongest: all sign
      },
      allocations: [],
    },
  ]);

  const createRes = await sendAndWait(createMsg);

  // app_session_id field can vary by node; try common keys
  const payload = createRes?.res?.[2] || {};
  const appSessionId: Hex | undefined =
    payload.app_session_id || payload.appSessionId || payload.session_id;

  if (!appSessionId) {
    throw new Error(
      `No app_session_id in response. Got keys: ${Object.keys(payload).join(", ")}`
    );
  }

  // 2) COMMIT state (lock intent) — minimal for now
  const commitAllocations = participants.map((p) => ({
    destination: p,
    amount: 0n,
  }));

  const commitMsg = await createSubmitAppStateMessage(sessionSigner, [
    { app_session_id: appSessionId, allocations: commitAllocations },
  ]);
  await sendAndWait(commitMsg);

  // 3) FINAL state (net settlement)
  // This is your “atomic batch settlement outcome”
  const finalAllocations = [
    { destination: seller, amount: params.sellerGets },
    { destination: provider, amount: params.providerFee },
    ...buyers.map((b) => ({ destination: b, amount: 0n })),
  ];

  const finalMsg = await createSubmitAppStateMessage(sessionSigner, [
    { app_session_id: appSessionId, allocations: finalAllocations },
  ]);
  await sendAndWait(finalMsg);

  // 4) CLOSE session (atomic)
  const closeMsg = await createCloseAppSessionMessage(sessionSigner, [
    { app_session_id: appSessionId, allocations: finalAllocations },
  ]);
  const closeRes = await sendAndWait(closeMsg);

  return {
    app_session_id: appSessionId,
    participants,
    sellerGets: params.sellerGets.toString(),
    providerFee: params.providerFee.toString(),
    closeType: closeRes?.res?.[1],
  };
}

// --------------------
// HTTP Server
// --------------------
const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ws: ws ? ws.readyState : null,
    authed: isAuthed,
    address: account.address,
    session_key: sessionKeyAddress,
    app: APP_NAME,
    scope: SCOPE,
  });
});

app.post("/yellow/connect", async (_req, res) => {
  try {
    await connectWS();
    res.json({ ok: true, ws: WS_URL });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/yellow/reset-session-key", async (_req, res) => {
  try {
    resetSessionKey();
    isAuthed = false;
    jwtToken = undefined;
    res.json({ ok: true, session_key: sessionKeyAddress });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.post("/yellow/auth", async (_req, res) => {
  try {
    await connectWS();
    const out = await doAuth();
    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/yellow/ledger", async (_req, res) => {
  try {
    const balances = await getLedgerBalances();
    res.json({ ok: true, balances });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

/**
 * Protocol endpoint: run a multi-party RWA swap session (USDC netting MVP)
 *
 * POST /protocol/rwa-swap
 * body:
 * {
 *   "provider": "0x...",
 *   "buyers": ["0x..","0x..","0x.."],
 *   "sellerGets": "9950",
 *   "providerFee": "50",
 *   "seller": "0x..." // optional, default = server EOA
 * }
 */
app.post("/protocol/rwa-swap", async (req, res) => {
  try {
    await connectWS();
    if (!isAuthed) await doAuth();

    const provider = req.body.provider as Hex;
    const buyers = req.body.buyers as Hex[];
    const seller = (req.body.seller as Hex | undefined) || undefined;

    const sellerGets = BigInt(req.body.sellerGets);
    const providerFee = BigInt(req.body.providerFee);

    if (!provider || !Array.isArray(buyers) || buyers.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "provider and buyers[] required",
      });
    }

    const out = await runRWASwapSession({
      seller,
      provider,
      buyers,
      sellerGets,
      providerFee,
    });

    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`\n✅ Server running on http://localhost:${PORT}`);
  console.log(`Address: ${account.address}`);
  console.log(`WS: ${WS_URL}`);
});
