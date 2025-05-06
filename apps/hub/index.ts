import { randomUUIDv7, type ServerWebSocket } from "bun";
import type { IncomingMessage, SignupIncomingMessage } from "common/types";
import { prismaClient } from "db/client";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import nacl_util from "tweetnacl-util";

const availableValidators: { validatorId: string, socket: ServerWebSocket<unknown>, publicKey: string }[] = [];

const CALLBACKS: { [callbackId: string]: (data: IncomingMessage) => void } = {}
const COST_PER_VALIDATION = 100; // in lamports

console.log("✅ Server starting with Bun...");

Bun.serve({
    fetch(req, server) {
        console.log("🌐 HTTP request received");
        if (server.upgrade(req)) {
            return;
        }
        return new Response("Upgrade failed", { status: 500 });
    },
    port: 8081,
    websocket: {
        async message(ws: ServerWebSocket<unknown>, message: string) {
            console.log("📨 Message received:", message);
            const data: IncomingMessage = JSON.parse(message);

            if (data.type === 'signup') {

                const verified = await verifyMessage(
                    `Signed message for ${data.data.callbackId}, ${data.data.publicKey}`,
                    data.data.publicKey,
                    data.data.signedMessage
                );
                console.log("User is Verified =>> ", verified);
                if (verified) {
                    await signupHandler(ws, data.data);
                }
            } else if (data.type === 'validate') {
                console.log("Validating message for ...", data);
                CALLBACKS[data.data.callbackId](data);
                delete CALLBACKS[data.data.callbackId];
            }
        },
        async close(ws: ServerWebSocket<unknown>) {
            availableValidators.splice(availableValidators.findIndex(v => v.socket === ws), 1);
        }
    },
});

console.log("🚀 Bun WebSocket server is running on port 8081");
async function signupHandler(ws: ServerWebSocket<unknown>, { ip, publicKey, signedMessage, callbackId }: SignupIncomingMessage) {
    const validatorDb = await prismaClient.validator.findFirst({
        where: {
            publicKey,
        },
    });


    if (validatorDb) {
        console.log("Validator already exists in the database.");
        ws.send(JSON.stringify({
            type: 'signup',
            data: {
                validatorId: validatorDb.id,
                callbackId,
            },
        }));

        availableValidators.push({
            validatorId: validatorDb.id,
            socket: ws,
            publicKey: validatorDb.publicKey,
        });
        return;
    }

    //TODO: Given the ip, return the location
    const validator = await prismaClient.validator.create({
        data: {
            ip,
            publicKey,
            location: 'unknown',
        },
    });

    ws.send(JSON.stringify({
        type: 'signup',
        data: {
            validatorId: validator.id,
            callbackId,
        },
    }));

    availableValidators.push({
        validatorId: validator.id,
        socket: ws,
        publicKey: validator.publicKey,
    });
}

async function verifyMessage(message: string, publicKey: string, signature: string) {
    const messageBytes = nacl_util.decodeUTF8(message);
    const result = nacl.sign.detached.verify(
        messageBytes,
        new Uint8Array(JSON.parse(signature)),
        new PublicKey(publicKey).toBytes(),
    );

    return result;
}

setInterval(async () => {
    console.log("⏱ Running monitoring check...");
    const websitesToMonitor = await prismaClient.website.findMany({
        where: {
            disabled: false,
        },
    });

    for (const website of websitesToMonitor) {
        console.log("Checking website...", website.url);
        availableValidators.forEach(validator => {
            const callbackId = randomUUIDv7();
            console.log(`Sending validate to ${validator.validatorId} ${website.url}`);
            validator.socket.send(JSON.stringify({
                type: 'validate',
                data: {
                    url: website.url,
                    callbackId
                },
            }));

            console.log(`🔎 Found ${websitesToMonitor.length} websites to monitor.`);
            CALLBACKS[callbackId] = async (data: IncomingMessage) => {
                if (data.type === 'validate') {
                    const { validatorId, status, latency, signedMessage } = data.data;
                    const verified = await verifyMessage(
                        `Replying to ${callbackId}`,
                        validator.publicKey,
                        signedMessage
                    );
                    if (!verified) {
                        return;
                    }

                    await prismaClient.$transaction(async (tx) => {
                        await tx.websiteTick.create({
                            data: {
                                websiteId: website.id,
                                validatorId,
                                status,
                                latency,
                                createdAt: new Date(),
                            },
                        });

                        await tx.validator.update({
                            where: { id: validatorId },
                            data: {
                                pendingPayouts: { increment: COST_PER_VALIDATION },
                            },
                        });
                    });
                }
            };
        });
    }
}, 10 * 1000);
