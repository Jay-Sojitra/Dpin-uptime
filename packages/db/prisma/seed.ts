import { prismaClient } from "../src";


async function seed() {

    await prismaClient.user.create({
        data: { id: "1", email: "test123@gmail.com" },
    });

    const validator = await prismaClient.validator.create({
        data: { id: "1", publicKey: "0x1234565432", location: "Rajkot", ip: "127.0.0.1" }
    });

    await prismaClient.website.create({
        data: { id: "2", userId: "1", url: "https://0xjay.vercel.app/" },
    });

    await prismaClient.websiteTick.create({
        data: { id: "4", websiteId: "2", validatorId: validator.id, status: "Good", latency: 100, createdAt: new Date() },
    });

    await prismaClient.websiteTick.create({
        data: { id: "5", websiteId: "2", validatorId: validator.id, status: "Bad", latency: 100, createdAt: new Date(Date.now() - 1000 * 60 * 10) },
    });
    await prismaClient.websiteTick.create({
        data: { id: "6", websiteId: "2", validatorId: validator.id, status: "Bad", latency: 100, createdAt: new Date(Date.now() - 1000 * 60 * 20) },
    });
    await prismaClient.websiteTick.create({
        data: { id: "7", websiteId: "2", validatorId: validator.id, status: "Good", latency: 100, createdAt: new Date(Date.now() - 1000 * 60 * 30) },
    });

}

seed();
