// Load environment variables FIRST (before any other imports read process.env)
import "dotenv/config";

import express from "express";
import cors from "cors";
import http from "http";
import morgan from "morgan";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";

import { getDb, getCollection, closeDb } from "./db.js";
import { SP } from "./ServiceProvider.js";
import accessPoint from "./AccessPoint.js";
import user from "./User.js";
import { startWatcher } from "./changeStreamWatcher.js";
import paymentRouter from "./payment.js";

const app = express();
const PORT = process.env.PORT || 3000;

// --- CORS: restrict origins via env (defaults to localhost Angular dev server) ---
const ALLOWED_ORIGINS =
  process.env.CORS_ORIGINS?.split(",") || "http://localhost:4200";
app.use(cors({ origin: ALLOWED_ORIGINS }));

// --- Middleware ---
app.use(compression()); // gzip compress all responses
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
app.use(paymentRouter);

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

  socket.on(
    "SP-Dashboard/sendNotificationToUser",
    ({ userEmail, message, requestServiceId, providerName }) => {
      console.log(
        `📣 Sending notification to ${userEmail}: ${message} (requestServiceId: ${requestServiceId}, providerName: ${providerName})`,
      );
      io.to(userEmail).emit("navbarComponent/notificationFromProvider", {
        message,
        requestServiceId,
        providerName,
      });
    },
  );

  socket.on(
    "serviceComponent/sendNotificationToProvider",
    ({ providerEmail, message, userLocation, requestServiceId, userName, userLat, userLng }) => {
      console.log(
        `📣 Sending notification to provider ${providerEmail}: ${message} (userLocation: ${userLocation}, requestServiceId: ${requestServiceId}, userName: ${userName})`,
      );
      io.to(providerEmail).emit("navbarComponent/notificationFromUser", {
        message,
        userLocation,
        requestServiceId,
        userName,
        userLat,
        userLng,
      });
    },
  );

  // --- Real-time location tracking events ---
  socket.on(
    "tracking/updateLocation",
    ({ userEmail, lat, lng, providerName, requestServiceId }) => {
      console.log(
        `📍 Location update from ${providerName} → ${userEmail} [${lat}, ${lng}]`,
      );
      io.to(userEmail).emit("tracking/providerLocation", {
        lat,
        lng,
        providerName,
        requestServiceId,
      });
    },
  );

  socket.on(
    "tracking/stopTracking",
    ({ userEmail, requestServiceId, providerName }) => {
      console.log(
        `🛑 Provider ${providerName} stopped tracking for request ${requestServiceId}`,
      );
      io.to(userEmail).emit("tracking/providerStopped", {
        requestServiceId,
        providerName,
      });
    },
  );

  // --- Payment: notify user that SP has dispatched → show Pay Now button ---
  socket.on(
    "payment/notifyUserDispatch",
    async ({ userEmail, requestServiceId, providerEmail, providerName }) => {
      try {
        console.log(
          `💳 SP ${providerName} dispatched request ${requestServiceId} → notifying ${userEmail} to pay`,
        );

        // Look up service price from the provider's services array in DB
        const { getCollection } = await import("./db.js");
        const spCol = await getCollection("serviceProviders");
        const provider = await spCol.findOne(
          { email: providerEmail },
          { projection: { services: 1, serviceProviderName: 1 } }
        );

        // Find the matching service request to get category, then find price
        const userCol = await getCollection("users");

        // Get the first service price if available
        let amount = 0;
        let serviceName = "Road Rescue Service";
        if (provider?.services?.length > 0) {
          amount = provider.services[0].price || 0;
          serviceName = provider.services[0].serviceName || serviceName;
        }

        io.to(userEmail).emit("payment/serviceDispatched", {
          requestServiceId,
          amount,
          serviceName,
          providerEmail,
          providerName,
        });
      } catch (err) {
        console.error("Error in payment/notifyUserDispatch:", err);
      }
    },
  );
});

let cleanupWatcher = null;

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

    // Start watching for real-time DB changes (auto-falls back to polling on standalone)
    cleanupWatcher = await startWatcher(io, col);

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
  cleanupWatcher?.();
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
