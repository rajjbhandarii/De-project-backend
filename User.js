import express from "express";
import { ObjectId } from "mongodb";
import { getCollection } from "./db.js";

const user = express.Router();

/* ---------------------------
   Public fetches
----------------------------*/
user.get("/services/fetch-serviceProvider", async (_, res) => {
  try {
    const serviceProvidersCollection = await getCollection("serviceProviders");
    const serviceProvider = await serviceProvidersCollection
      .find(
        {},
        {
          projection: {
            _id: 1,
            serviceProviderName: 1,
            services: 1,
          },
        },
      )
      .toArray();
    res.json(serviceProvider);
  } catch (err) {
    console.error("Error fetching service providers:", err);
    res.status(500).json({ message: "Failed to fetch service providers" });
  }
});

user.post("/services/request-services", async (req, res) => {
  const {
    _id: providerId,
    userName,
    userLocation,
    category,
    requestServiceId,
  } = req.body;

  try {
    if (!providerId || !ObjectId.isValid(providerId)) {
      return res.status(400).json({ message: "Invalid or missing providerId" });
    }

    const col = await getCollection("serviceProviders");

    const providerObjectId = new ObjectId(String(providerId));

    const updateResult = await col.updateOne(
      { _id: providerObjectId },
      {
        $push: {
          serviceRequestInfo: {
            requestServiceId,
            userName,
            userLocation,
            category,
            createdAt: new Date(),
          },
        },
      },
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ message: "Service provider not found" });
    }

    return res
      .status(201)
      .json({ message: "Service request recorded successfully" });
  } catch (err) {
    console.error("Error inserting service request:", err);
    res.status(500).json({ message: "Failed to process service request" });
  }
});

export default user;
