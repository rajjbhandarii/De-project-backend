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
import { startWatcher } from "./changeStreamWatcher.js";

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
