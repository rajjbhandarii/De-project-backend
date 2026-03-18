import express from "express";
import connectDB from "./db.js";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

import { SP } from "./ServiceProvider.js";
import accessPoint from "./AccessPoint.js";
import user from "./User.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use(SP);
app.use(accessPoint);
app.use(user);

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
          "🔍 Change stream listening on serviceProviders collection",
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
            "Max retries reached. Change stream will not be initialized.",
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
                k.startsWith("serviceRequestInfo."),
              )
            ) {
              const newRequest = Object.values(updatedFields)[0];

              // 🔑 Fetch provider email (needed for room)
              const provider = await col.findOne(
                { _id: change.documentKey._id },
                { projection: { email: 1 } },
              );

              if (!provider?.email) return;

              io.to(`provider:dashboard:${provider.email}`).emit(
                "serviceRequestUpdated",
                newRequest,
              );

              console.log(
                `⚡ Service request sent to provider:dashboard:${provider.email}`,
              );
            } else if (
              Object.keys(updatedFields).some((k) => k.startsWith("services."))
            ) {
              const newService = Object.values(updatedFields)[0];

              const provider = await col.findOne(
                { _id: change.documentKey._id },
                { projection: { email: 1, serviceProviderName: 1 } },
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
                `⚡ Service update broadcasted to all users for provider: ${provider.serviceProviderName}`,
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
          `Attempting to re-establish change stream in ${delay}ms...`,
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
