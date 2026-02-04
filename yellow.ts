import { NitroliteClient, WalletStateSigner, createECDSAMessageSigner } from '@erc7824/nitrolite';
import { createPublicClient, createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import WebSocket from 'ws';
import 'dotenv/config';

// Setup Viem Clients
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.ALCHEMY_RPC_URL) });
const walletClient = createWalletClient({ chain: sepolia, transport: http(), account });

// Initialize Nitrolite Client
const client = new NitroliteClient({
    publicClient,
    walletClient,
    stateSigner: new WalletStateSigner(walletClient),
    addresses: {
        custody: '0x019B65A265EB3363822f2752141b3dF16131b262',
        adjudicator: '0x7c7ccbc98469190849BCC6c926307794fDfB11F2',
    },
    chainId: sepolia.id,
    challengeDuration: 3600n,
});

// Connect to Sandbox Node
const ws = new WebSocket('wss://clearnet-sandbox.yellow.com/ws');