import express, { Request, Response } from "express";
import { authMiddleware } from "./middleware";
import { prismaClient } from "db/client";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

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



app.listen(8080, () => {
    console.log("Server is running on port 8080");
});
