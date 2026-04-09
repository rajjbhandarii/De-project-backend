// Load environment variables FIRST (before any other imports read process.env)
import "dotenv/config";

import express from "express";
import cors from "cors";
import http from "http";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";

import { getDb, getCollection, closeDb } from "./db.js";
import { SP } from "./ServiceProvider.js";
import accessPoint from "./AccessPoint.js";
import user from "./User.js";

const app = express();
const PORT = process.env.PORT || 3000;

// --- CORS: restrict origins via env (defaults to localhost Angular dev server) ---
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS?.split(",") ||
  "http://localhost:4200";
app.use(cors({ origin: ALLOWED_ORIGINS }));

// --- Middleware ---
app.use(express.json());
app.use(morgan("dev"));

// --- Rate limiting on auth endpoints ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: "Too many attempts, please try again later" },
});
app.use("/login-", authLimiter);
app.use("/signup-", authLimiter);

// --- Routes ---
app.use(SP);
app.use(accessPoint);
app.use(user);

// --- REAL-TIME / SOCKET.IO SETUP ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS } });

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
const MAX_RETRIES = 5;

async function startServer() {
  try {
    const db = await getDb();
    console.log("📦 Connected to MongoDB");

    const col = await getCollection("serviceProviders");

    // Ensure unique indexes (idempotent — safe to run on every start)
    await db
      .collection("serviceProviders")
      .createIndex({ email: 1 }, { unique: true });
    await db.collection("users").createIndex({ email: 1 }, { unique: true });

    // Start watching change stream for real-time DB updates with error handling and reconnection logic
    async function setupChangeStream(retryCount = 0) {
      let changeStream;
      try {
        changeStream = col.watch();
        console.log(
          "🔍 Change stream listening on serviceProviders collection",
        );
      } catch (err) {
        console.error("Failed to initialize change stream:", err);

        // Retry with exponential backoff
        if (retryCount < MAX_RETRIES) {
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
          const updatedFields =
            change.updateDescription?.updatedFields || {};

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
              // Pick the correct key instead of blindly grabbing the first value
              const requestKey = Object.keys(updatedFields).find((k) =>
                k.startsWith("serviceRequestInfo."),
              );
              const newRequest = updatedFields[requestKey];

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
              Object.keys(updatedFields).some((k) =>
                k.startsWith("services."),
              )
            ) {
              const serviceKey = Object.keys(updatedFields).find((k) =>
                k.startsWith("services."),
              );
              const newService = updatedFields[serviceKey];

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
        // Retry with exponential backoff
        if (retryCount < MAX_RETRIES) {
          const nextRetry = retryCount + 1;
          const delay = Math.min(1000 * Math.pow(2, nextRetry), 10000);
          console.log(
            `Attempting to re-establish change stream in ${delay}ms...`,
          );
          setTimeout(() => setupChangeStream(nextRetry), delay);
        } else {
          console.error(
            "Max retries reached. Change stream will not be re-established.",
          );
        }
      });

      // Handle 'close' event with retry cap
      changeStream.on("close", () => {
        console.warn("Change stream closed.");
        if (retryCount < MAX_RETRIES) {
          console.log("Attempting to re-establish...");
          setTimeout(() => setupChangeStream(retryCount + 1), 1000);
        } else {
          console.error("Max retries reached after close events.");
        }
      });
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

// --- Graceful shutdown ---
async function shutdown(signal) {
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  server.close(() => {
    console.log("🔌 HTTP server closed.");
  });
  io.close();
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer();
