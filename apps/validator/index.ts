import { randomUUIDv7 } from "bun";
import type { OutgoingMessage, SignupOutgoingMessage, ValidateOutgoingMessage } from "common/types";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import nacl_util from "tweetnacl-util";
import bs58 from "bs58";

console.log("🔧 Validator client is starting...");

const CALLBACKS: { [callbackId: string]: (data: SignupOutgoingMessage) => void } = {};

let validatorId: string | null = null;

async function main() {
    console.log("🔐 Loading keypair from environment variable...");
    const keypair = Keypair.fromSecretKey(
        bs58.decode(process.env.PAYER_PRIVATE_KEY!)
    );

    const ws = new WebSocket("ws://localhost:8081");

    ws.onopen = async () => {
        console.log("🌐 Connected to WebSocket server.");
        const callbackId = randomUUIDv7();
        CALLBACKS[callbackId] = (data: SignupOutgoingMessage) => {
            validatorId = data.validatorId;
            console.log(`✅ Signed up with validatorId: ${validatorId}`);
        };

        const signedMessage = await signMessage(`Signed message for ${callbackId}, ${keypair.publicKey}`, keypair);

        ws.send(JSON.stringify({
            type: 'signup',
            data: {
                callbackId,
                ip: '127.0.0.1',
                publicKey: keypair.publicKey,
                signedMessage,
            },
        }));
        console.log("📨 Sent signup request to server.");
    };

    ws.onmessage = async (event) => {
        const data: OutgoingMessage = JSON.parse(event.data);
        console.log("📩 Message received from server:", data.type);

        if (data.type === 'signup') {
            console.log("📩 Signup response received:", data.data);
            CALLBACKS[data.data.callbackId]?.(data.data);
            delete CALLBACKS[data.data.callbackId];
        } else if (data.type === 'validate') {
            await validateHandler(ws, data.data, keypair);
        }
    };

    ws.onerror = (err) => {
        console.error("❌ WebSocket error:", err);
    };

    ws.onclose = () => {
        console.warn("⚠️ WebSocket connection closed.");
    };
}

async function validateHandler(ws: WebSocket, { url, callbackId, websiteId }: ValidateOutgoingMessage, keypair: Keypair) {
    console.log(`🔍 Validating URL: ${url}`);
    const startTime = Date.now();
    const signature = await signMessage(`Replying to ${callbackId}`, keypair);

    try {
        const response = await fetch(url);
        const endTime = Date.now();
        const latency = endTime - startTime;
        const status = response.status;

        console.log(`✅ Validation result: ${url} responded with ${status} in ${latency}ms`);

        ws.send(JSON.stringify({
            type: 'validate',
            data: {
                callbackId,
                status: status === 200 ? 'Good' : 'Bad',
                latency,
                websiteId,
                validatorId,
                signedMessage: signature,
            },
        }));
    } catch (error) {
        console.error(`❌ Error validating ${url}:`, error);

        ws.send(JSON.stringify({
            type: 'validate',
            data: {
                callbackId,
                status: 'Bad',
                latency: 1000,
                websiteId,
                validatorId,
                signedMessage: signature,
            },
        }));
    }
}

async function signMessage(message: string, keypair: Keypair) {
    console.log(`✍️ Signing message: ${message}`);
    const messageBytes = nacl_util.decodeUTF8(message);
    const signature = nacl.sign.detached(messageBytes, keypair.secretKey);

    return JSON.stringify(Array.from(signature));
}

main();

setInterval(() => {
    console.log("⏱️ Heartbeat: Validator still running...");
}, 10000);
