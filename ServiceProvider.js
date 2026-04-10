import express from "express";
import { getCollection } from "./db.js";
import { invalidateCache } from "./User.js";

const SP = express.Router();

/* ---------------------------
   Provider dashboard initial fetch
----------------------------*/
SP.post("/SP-dashboard/fetch-servicesRequests", async (req, res) => {
  const { serviceProviderEmail } = req.body;
  try {
    if (!serviceProviderEmail) {
      return res.status(400).json({ message: "Missing email" });
    }

    const col = await getCollection("serviceProviders");
    const provider = await col.findOne(
      { email: serviceProviderEmail },
      { projection: { serviceRequestInfo: 1 } },
    );

    if (!provider) {
      return res.status(404).json({ message: "Service provider not found" });
    }

    res.json(provider.serviceRequestInfo || []);
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).json({ message: "Failed to fetch services" });
  }
});

SP.delete("/SP-dashboard/delete-serviceRequest", async (req, res) => {
  try {
    const { serviceProviderEmail, requestServiceId } = req.body;
    if (!serviceProviderEmail || !requestServiceId) {
      return res
        .status(400)
        .json({ message: "Missing serviceProviderEmail or requestServiceId" });
    }

    console.log("Deleting service request:", {
      serviceProviderEmail,
      requestServiceId,
    });
    const col = await getCollection("serviceProviders");
    const result = await col.updateOne(
      { email: serviceProviderEmail },
      { $pull: { serviceRequestInfo: { requestServiceId } } },
    );
    if (!result || result.modifiedCount === 0) {
      return res.status(404).json({ message: "Service request not found" });
    }
    res.status(200).json({ message: "Service request deleted successfully" });
  } catch (err) {
    console.error("Error deleting service request:", err);
    res.status(500).json({ message: "Failed to delete service request" });
  }
});
/* ---------------------------
   Service management (add service)
----------------------------*/
SP.post("/serviceManagement/addNewServices", async (req, res) => {
  try {
    const { newService, serviceProviderEmail } = req.body;
    const col = await getCollection("serviceProviders");
    await col.updateOne(
      { email: serviceProviderEmail },
      {
        $push: {
          services: { ...newService, rating: 0 },
        },
      },
    );
    invalidateCache(); // bust provider list cache
    res.status(201).json({ message: "Service added successfully" });
  } catch (err) {
    console.error("Error adding service:", err);
    res.status(500).json({ message: "Failed to add service" });
  }
});

SP.get("/serviceManagement/getServicesCategory", async (req, res) => {
  const { serviceProviderEmail } = req.query;
  try {
    const col = await getCollection("serviceProviders");
    const services = await col.findOne(
      { email: serviceProviderEmail },
      { projection: { services: 1, _id: 1 } },
    );
    if (!services)
      return res.status(404).json({ message: "Service provider not found" });
    res.json(services.services || []);
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).json({ message: "Failed to fetch services" });
  }
});

SP.delete("/serviceManagement/deleteService", async (req, res) => {
  try {
    const { serviceProviderEmail, serviceId } = req.body;
    const col = await getCollection("serviceProviders");
    const result = await col.updateOne(
      { email: serviceProviderEmail },
      { $pull: { services: { serviceId: serviceId } } },
    );
    if (!result || result.modifiedCount === 0) {
      return res.status(404).json({ message: "Service not found" });
    }
    invalidateCache(); // bust provider list cache
    res.status(200).json({ message: "Service deleted successfully" });
  } catch (err) {
    console.error("Error deleting service:", err);
    res.status(500).json({ message: "Failed to delete service" });
  }
});

export { SP };
