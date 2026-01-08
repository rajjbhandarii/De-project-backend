import express from "express";
import connectDB from "./db.js";
import cors from "cors";
import JWT from "jsonwebtoken";
import http from "http";
import { Server } from "socket.io";
import { ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const env = process.env.JWT_SECRET || "iuehdkif83br6w3bnskxJ9jT";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let db; // will hold the connected DB instance

// --- REAL-TIME / SOCKET.IO SETUP (single instance) ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Socket connection handlers for webhook updates to update the UI in real-time
io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  socket.on("join-room", ({ room }) => {
    if (!room) return;
    socket.join(room);
    console.log(`🟢 Socket ${socket.id} joined room: ${room}`);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Socket disconnected:", socket.id);
  });
});

// Helper to get the established DB connection
function getDb() {
  if (!db) throw new Error("Database not connected");
  return db;
}
async function getCollection(collectionName) {
  return (await getDb()).collection(collectionName);
}

/* ---------------------------
   Registration endpoint (generic)
----------------------------*/
async function registerPoint(req, res, collectionName, type, nameField) {
  const {
    [nameField]: userNameOrserviceProviderName,
    email,
    password,
  } = req.body;

  if (!email || !password || !userNameOrserviceProviderName) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    const collection = await getCollection(collectionName);
    const existing = await collection.findOne({ email });

    if (existing) {
      return res.status(409).json({
        message: `${
          type.charAt(0).toUpperCase() + type.slice(1)
        } already exists`,
      });
    }

    // const hashedPassword = await bcrypt.hash(password, 10);
    await collection.insertOne({
      email,
      [nameField]: userNameOrserviceProviderName,
      password,
    });

    const token = JWT.sign(
      { [nameField]: userNameOrserviceProviderName, email },
      env,
      { expiresIn: "1h" }
    );

    res.status(201).json({
      message: `${
        type.charAt(0).toUpperCase() + type.slice(1)
      } registered successfully`,
      token,
    });
  } catch (err) {
    console.error("Error in registerPoint:", err);
    res.status(500).json({ message: "Server error" });
  }
}

app.post("/signup-serviceProvider", (req, res) =>
  registerPoint(
    req,
    res,
    "serviceProviders",
    "Towing Service",
    "serviceProviderName"
  )
);

app.post("/signup-user", (req, res) =>
  registerPoint(req, res, "users", "user", "userName")
);

/* ---------------------------
   Login endpoint (generic)
----------------------------*/
async function loginPoint(req, res, collectionName, emailField, nameField) {
  const { [emailField]: providedEmail, password } = req.body;

  try {
    const collection = await getCollection(collectionName);
    const user = await collection.findOne({ [emailField]: providedEmail });

    // Basic validation: user exists and password matches
    if (!user || user.password !== password) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = JWT.sign(
      {
        id: user._id,
        username: user[nameField],
        email: user[emailField],
        type: user.type,
      },
      env,
      { expiresIn: "1h" }
    );

    res.json({ message: "Login successful", token, name: user[nameField] });
  } catch (err) {
    console.error(`Error in /login-${collectionName}:`, err);
    res.status(500).json({ message: "Server error" });
  }
}

app.post("/login-serviceProvider", (req, res) =>
  loginPoint(req, res, "serviceProviders", "email", "serviceProviderName")
);

app.post("/login-user", (req, res) =>
  loginPoint(req, res, "users", "email", "userName")
);

/* ---------------------------
   Remove endpoints
----------------------------*/
async function removePoint(req, res, collectionName, nameField, type) {
  const nameValue = req.params[nameField];
  try {
    const collection = await getCollection(collectionName);
    const result = await collection.deleteOne({ [nameField]: nameValue });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: `${type} not found` });
    }
    res.json({ message: `${type} removed successfully` });
  } catch (err) {
    console.error(`Error in remove${type}:`, err);
    res.status(500).json({ message: "Server error" });
  }
}

app.delete("/remove-serviceProvider/:serviceProviderName", (req, res) =>
  removePoint(
    req,
    res,
    "serviceProviders",
    "serviceProviderName",
    "serviceProvider"
  )
);

app.delete("/remove-user/:userName", (req, res) =>
  removePoint(req, res, "users", "userName", "User")
);

/* ---------------------------
   Public fetches
----------------------------*/
app.get("/services/fetch-serviceProvider", async (_, res) => {
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
        }
      )
      .toArray();
    res.json(serviceProvider);
  } catch (err) {
    console.error("Error fetching service providers:", err);
    res.status(500).json({ message: "Failed to fetch service providers" });
  }
});

app.post("/services/request-services", async (req, res) => {
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
      }
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

/* ---------------------------
   Provider dashboard initial fetch
----------------------------*/
app.post("/SP-dashboard/fetch-servicesRequests", async (req, res) => {
  const { serviceProviderEmail } = req.body;
  try {
    if (!serviceProviderEmail) {
      return res.status(400).json({ message: "Missing email" });
    }

    const col = await getCollection("serviceProviders");
    const provider = await col.findOne(
      { email: serviceProviderEmail },
      { projection: { serviceRequestInfo: 1 } }
    );

    if (!provider) {
      return res.status(404).json({ message: "Service providerr not found" });
    }

    res.json(provider.serviceRequestInfo || []);
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).json({ message: "Failed to fetch services" });
  }
});

/* ---------------------------
   Service management (add service)
----------------------------*/
app.post("/serviceManagement/addNewServices", async (req, res) => {
  try {
    const { newService, serviceProviderEmail } = req.body;
    const col = await getCollection("serviceProviders");
    await col.updateOne(
      { email: serviceProviderEmail },
      {
        $push: {
          services: { ...newService, rating: 4.3 },
        },
      }
    );
    res.status(201).json({ message: "Service added successfully" });
  } catch (err) {
    console.error("Error adding service:", err);
    res.status(500).json({ message: "Failed to add service" });
  }
});

app.get("/serviceManagement/getServicesCategory", async (req, res) => {
  const { serviceProviderEmail } = req.query;
  try {
    const col = await getCollection("serviceProviders");
    const services = await col.findOne(
      { email: serviceProviderEmail },
      { projection: { services: 1, _id: 1 } }
    );
    if (!services)
      return res.status(404).json({ message: "Service provider not found" });
    res.json(services.services || []);
  } catch (err) {
    console.error("Error fetching services:", err);
    res.status(500).json({ message: "Failed to fetch services" });
  }
});

app.delete("/serviceManagement/deleteService", async (req, res) => {
  try {
    const { serviceProviderEmail, serviceId } = req.body;
    const col = await getCollection("serviceProviders");
    const result = await col.updateOne(
      { email: serviceProviderEmail },
      { $pull: { services: { serviceId: serviceId } } }
    );
    if (!result || result.modifiedCount === 0) {
      return res.status(404).json({ message: "Service not found" });
    }
    res.status(200).json({ message: "Service deleted successfully" });
  } catch (err) {
    console.error("Error deleting service:", err);
    res.status(500).json({ message: "Failed to delete service" });
  }
});

/* ---------------------------
   Start server and setup change stream
----------------------------*/
async function startServer() {
  try {
    db = await connectDB();
    console.log("📦 Connected to MongoDB");

    const col = db.collection("serviceProviders");

    // Ensure unique indexes
    await db
      .collection("serviceProviders")
      .createIndex({ email: 1 }, { unique: true });
    await db.collection("users").createIndex({ email: 1 }, { unique: true });

    // Start watching change stream for real-time DB updates with error handling and reconnection logic
    async function setupChangeStream(retryCount = 0) {
      let changeStream;
      try {
        //-->>comment this if using atlas
        // Check if replica set is available
        // const adminDb = db.admin();
        // const serverStatus = await adminDb.serverStatus();

        // if (!serverStatus.repl || serverStatus.repl.ismaster === undefined) {
        //   console.warn(
        //     "⚠️  Change streams disabled: MongoDB is not using atlas cloude.\n" +
        //       "   Real-time updates will not work."
        //   );
        //   return;
        // }

        changeStream = col.watch();
        console.log(
          "🔍 Change stream listening on serviceProviders collection"
        );
      } catch (err) {
        console.error("Failed to initialize change stream:", err);

        //-->>uncomment to enable 'retries' after using connection string of altas

        // Retry with exponential backoff, max 5 attempts
        if (retryCount < 5) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
          console.log(`Retrying change stream initialization in ${delay}ms...`);
          setTimeout(() => setupChangeStream(retryCount + 1), delay);
        } else {
          console.error(
            "Max retries reached. Change stream will not be initialized."
          );
        }
        console.warn("⚠️  Continuing without real-time updates...");
        return;
      }

      changeStream.on("change", async (change) => {
        try {
          const updatedFields = change.updateDescription?.updatedFields || {};
          // we care about inserts/updates/replaces (anything that can change serviceRequestInfo)
          if (
            change.operationType === "update" ||
            change.operationType === "replace" ||
            change.operationType === "insert"
          ) {
            if (
              change.operationType === "update" &&
              Object.keys(updatedFields).some((k) =>
                k.startsWith("serviceRequestInfo.")
              )
            ) {
              const newRequest = Object.values(updatedFields)[0];

              // 🔑 Fetch provider email (needed for room)
              const provider = await col.findOne(
                { _id: change.documentKey._id },
                { projection: { email: 1 } }
              );

              if (!provider?.email) return;

              io.to(`provider:dashboard:${provider.email}`).emit(
                "serviceRequestUpdated",
                newRequest
              );

              console.log(
                `⚡ Service request sent to provider:dashboard:${provider.email}`
              );
            } else if (
              Object.keys(updatedFields).some((k) => k.startsWith("services."))
            ) {
              const newService = Object.values(updatedFields)[0];

              const provider = await col.findOne(
                { _id: change.documentKey._id },
                { projection: { email: 1, serviceProviderName: 1 } }
              );

              if (!provider) return;

              // Broadcast to all users instead of a specific room
              io.emit("servicesUpdated", [
                {
                  _id: provider._id.toString(),
                  serviceProviderName: provider.serviceProviderName,
                  services: [newService],
                },
              ]);
              console.log(
                `⚡ Service update broadcasted to all users for provider: ${provider.serviceProviderName}`
              );
            }
          }
        } catch (err) {
          console.error("Error handling change event:", err);
        }
      });

      // handle change stream errors and attempt to reconnect
      changeStream.on("error", (err) => {
        console.error("Change stream error:", err);
        try {
          changeStream.close();
        } catch (closeErr) {
          console.error("Error closing change stream:", closeErr);
        }
        // Retry with exponential backoff, max 5 attempts
        const nextRetry = Math.min(retryCount + 1, 5);
        const delay = Math.min(1000 * Math.pow(2, nextRetry), 10000);
        console.log(
          `Attempting to re-establish change stream in ${delay}ms...`
        );
        setTimeout(() => setupChangeStream(nextRetry), delay);
      });

      // Optionally handle 'close' event (MongoDB driver >=4.0)
      if (typeof changeStream.on === "function") {
        changeStream.on("close", () => {
          console.warn("Change stream closed. Attempting to re-establish...");
          setTimeout(() => setupChangeStream(retryCount + 1), 1000);
        });
      }
    }

    setupChangeStream();

    server.listen(PORT, () => {
      console.log(`🚀 Real-time server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB or start server:", error);
    process.exit(1);
  }
}

startServer();
