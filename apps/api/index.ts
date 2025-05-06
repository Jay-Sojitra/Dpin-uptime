import express from "express";
import type { Request, Response } from "express";
import { authMiddleware } from "./middleware";
import { prismaClient } from "db/client";
import bs58 from "bs58";
import cors from "cors";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Solana connection setup
const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com");
console.log("hello");
console.log("PAYER_PRIVATE_KEY", process.env.PAYER_PRIVATE_KEY);
// Load the payer keypair from env (this should be the account funding payouts)
// const payerKeypair = Keypair.fromSecretKey(
//     Uint8Array.from(JSON.parse(process.env.PAYER_PRIVATE_KEY || "[]"))
// );
const payerKeypair = Keypair.fromSecretKey(
    bs58.decode(process.env.PAYER_PRIVATE_KEY!)
);

console.log("PAYER_PUBLIC_KEY", payerKeypair);
// Utility function to request SOL from devnet faucet
async function requestAirdrop() {
    try {
        const signature = await connection.requestAirdrop(
            payerKeypair.publicKey,
            2 * 1000000000 // 2 SOL in lamports
        );
        await connection.confirmTransaction(signature);
        console.log(`Airdrop successful! Signature: ${signature}`);
        const balance = await connection.getBalance(payerKeypair.publicKey);
        console.log(`New balance: ${balance / 1000000000} SOL`);
        return true;
    } catch (error) {
        console.error("Airdrop failed:", error);
        return false;
    }
}

app.post("/api/v1/website", authMiddleware, async (req: Request, res: Response) => {

    const userId = req.userId!;
    const { url } = req.body;


    const data = await prismaClient.website.create({
        data: {
            userId,
            url
        },
    });

    res.json({ id: data.id });
});

app.get("api/v1/website/status", authMiddleware, async (req, res) => {
    const userId = req.userId!;
    const { websiteId } = req.query;

    const data = await prismaClient.website.findFirst({
        where: {
            id: websiteId as string,
            userId,
            disabled: false
        },
        include: {
            ticks: true
        }
    });

    res.json(data);
});

app.get("/api/v1/websites", authMiddleware, async (req, res) => {

    const userId = req.userId!;

    const websites = await prismaClient.website.findMany({
        where: {
            userId,
            disabled: false
        },
        include: {
            ticks: true
        }
    });

    res.json({ websites });

});

app.delete("/api/v1/website", authMiddleware, async (req, res) => {

    const userId = req.userId!;
    const websiteId = req.body.websiteId;

    await prismaClient.website.update({
        where: {
            id: websiteId,
            userId
        },
        data: {
            disabled: true
        }
    });

    res.json({ message: "Deleted website successfully" });
});


// Endpoint for validator payouts
app.post("/api/v1/payout/:validatorId", async (req, res) => {
    const { validatorId } = req.params;

    try {
        // Use a database transaction to ensure atomicity
        const result = await prismaClient.$transaction(async (tx) => {
            // 1. Get validator and check if there are pending payouts
            const validator = await tx.validator.findUnique({
                where: { id: validatorId }
            });

            if (!validator) {
                throw new Error("Validator not found");
            }

            if (validator.pendingPayouts <= 0) {
                throw new Error("No pending payouts for this validator");
            }

            const amountToPayInLamports = validator.pendingPayouts;

            // 2. Update the database to zero out the pending payouts
            // (This happens first to prevent double payments)
            const updatedValidator = await tx.validator.update({
                where: { id: validatorId },
                data: { pendingPayouts: 0 }
            });

            // 3. Create the Solana transaction
            try {
                const recipientPublicKey = new PublicKey(validator.publicKey);

                // Check if payer has enough balance
                const payerBalance = await connection.getBalance(payerKeypair.publicKey);
                if (payerBalance < amountToPayInLamports) {
                    throw new Error(`Insufficient funds. Payer has ${payerBalance} lamports, but ${amountToPayInLamports} are needed.`);
                }

                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: payerKeypair.publicKey,
                        toPubkey: recipientPublicKey,
                        lamports: amountToPayInLamports
                    })
                );

                // 4. Send the transaction to the Solana network
                const signature = await sendAndConfirmTransaction(
                    connection,
                    transaction,
                    [payerKeypair] // Signers
                );

                // 5. Return both the DB update and transaction signature
                return {
                    validator: updatedValidator,
                    signature,
                    amount: amountToPayInLamports
                };
            } catch (solanaError) {
                // If Solana transaction fails, we need to revert our DB change
                // by putting the pending amount back
                await tx.validator.update({
                    where: { id: validatorId },
                    data: { pendingPayouts: amountToPayInLamports }
                });

                throw new Error(`Solana transaction failed: ${solanaError.message}`);
            }
        });

        // Success response
        res.json({
            success: true,
            message: "Payment processed successfully",
            validatorId: result.validator.id,
            amount: result.amount,
            signature: result.signature,
            transactionUrl: `https://explorer.solana.com/tx/${result.signature}?cluster=${process.env.SOLANA_NETWORK || 'devnet'}`
        });

    } catch (error) {
        console.error("Payment processing error:", error);
        res.status(400).json({
            success: false,
            message: error.message || "Failed to process payment"
        });
    }
});

// Admin endpoints for managing the payer account
app.get("/api/v1/admin/balance", async (req, res) => {
    try {
        const balance = await connection.getBalance(payerKeypair.publicKey);
        res.json({
            publicKey: payerKeypair.publicKey.toString(),
            balance: balance / 1000000000, // Convert lamports to SOL
            lamports: balance
        });
    } catch (error) {
        res.status(500).json({
            error: "Failed to get balance",
            message: error.message
        });
    }
});

app.post("/api/v1/admin/airdrop", async (req, res) => {
    try {
        const success = await requestAirdrop();
        if (success) {
            const balance = await connection.getBalance(payerKeypair.publicKey);
            res.json({
                success: true,
                message: "Airdrop successful",
                publicKey: payerKeypair.publicKey.toString(),
                balance: balance / 1000000000, // Convert lamports to SOL
                lamports: balance
            });
        } else {
            res.status(500).json({
                success: false,
                message: "Airdrop failed"
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: "Failed to request airdrop",
            message: error.message
        });
    }
});

app.listen(8080, () => {
    console.log("Server is running on port 8080");
});
