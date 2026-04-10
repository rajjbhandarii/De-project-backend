/**
 * changeStreamWatcher.js
 *
 * Watches the serviceProviders collection for real-time changes and emits
 * socket events.  Automatically falls back to polling when the MongoDB
 * instance is standalone (no replica set) and change streams are unavailable.
 *
 * Usage:
 *   import { startWatcher } from "./changeStreamWatcher.js";
 *   const cleanup = await startWatcher(io, col);
 *   // later, on shutdown:
 *   cleanup();
 */

const MAX_RETRIES = 5;
const POLL_INTERVAL_MS = 3000; // polling interval in ms

// ---- internal state ----
let pollingTimer = null;
const docSnapshots = new Map(); // Map<stringId, snapshot>

// =========================================================================
//  Polling fallback – used when MongoDB is standalone (no replica set)
// =========================================================================

async function setupPollingFallback(io, col) {
  console.log(
    "🔄 Polling fallback active – checking serviceProviders every",
    `${POLL_INTERVAL_MS / 1000}s`,
  );

  // Build the initial snapshot so we don't fire false positives on first run
  const initialDocs = await col
    .find(
      {},
      {
        projection: {
          email: 1,
          serviceProviderName: 1,
          serviceRequestInfo: 1,
          services: 1,
        },
      },
    )
    .toArray();

  for (const doc of initialDocs) {
    docSnapshots.set(doc._id.toString(), {
      serviceRequestInfo: JSON.stringify(doc.serviceRequestInfo ?? {}),
      services: JSON.stringify(doc.services ?? {}),
      email: doc.email,
      serviceProviderName: doc.serviceProviderName,
    });
  }

  pollingTimer = setInterval(async () => {
    try {
      const docs = await col
        .find(
          {},
          {
            projection: {
              email: 1,
              serviceProviderName: 1,
              serviceRequestInfo: 1,
              services: 1,
            },
          },
        )
        .toArray();

      for (const doc of docs) {
        const id = doc._id.toString();
        const prev = docSnapshots.get(id);
        const curReqStr = JSON.stringify(doc.serviceRequestInfo ?? {});
        const curSvcStr = JSON.stringify(doc.services ?? {});

        if (!prev) {
          // New document (insert)
          docSnapshots.set(id, {
            serviceRequestInfo: curReqStr,
            services: curSvcStr,
            email: doc.email,
            serviceProviderName: doc.serviceProviderName,
          });
          continue;
        }

        // Check serviceRequestInfo changes
        if (curReqStr !== prev.serviceRequestInfo && doc.email) {
          io.to(`provider:dashboard:${doc.email}`).emit(
            "serviceRequestUpdated",
            doc.serviceRequestInfo,
          );
          console.log(
            `⚡ [poll] Service request sent to provider:dashboard:${doc.email}`,
          );
        }

        // Check services changes
        if (curSvcStr !== prev.services && doc.serviceProviderName) {
          io.emit("servicesUpdated", [
            {
              _id: id,
              serviceProviderName: doc.serviceProviderName,
              services: doc.services,
            },
          ]);
          console.log(
            `⚡ [poll] Service update broadcasted for provider: ${doc.serviceProviderName}`,
          );
        }

        // Update snapshot
        docSnapshots.set(id, {
          serviceRequestInfo: curReqStr,
          services: curSvcStr,
          email: doc.email,
          serviceProviderName: doc.serviceProviderName,
        });
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, POLL_INTERVAL_MS);
}

// =========================================================================
//  Change stream (primary) – auto-falls back to polling on standalone
// =========================================================================

async function setupChangeStream(io, col, retryCount = 0) {
  let changeStream;
  try {
    // Use a throwaway stream to probe whether change streams are supported.
    // tryNext() puts the stream in iterator mode, which is incompatible
    // with .on("change") (event emitter mode).  So we probe on a separate
    // cursor and immediately close it, then create the real one below.
    const probe = col.watch();
    await probe.tryNext();
    await probe.close();

    // Now create the actual change stream for listening
    changeStream = col.watch([], { fullDocument: "updateLookup" });

    console.log("🔍 Change stream listening on serviceProviders collection");
  } catch (err) {
    // Detect standalone-specific errors and fall back to polling
    if (
      /replica|not supported|topology|standalone/.test(err.message) ||
      err.code === 40573 ||
      err.code === 40
    ) {
      console.warn(
        "⚠️  Change streams require a replica set.",
        "Falling back to polling for real-time updates.",
      );
      try {
        changeStream?.close();
      } catch (_) {
        /* ignore */
      }
      await setupPollingFallback(io, col);
      return;
    }

    console.error("Failed to initialize change stream:", err);

    // Retry with exponential backoff for transient errors
    if (retryCount < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
      console.log(`Retrying change stream initialization in ${delay}ms...`);
      try {
        changeStream?.close();
      } catch (_) {
        /* ignore */
      }
      setTimeout(() => setupChangeStream(io, col, retryCount + 1), delay);
    } else {
      console.error("Max retries reached. Falling back to polling.");
      try {
        changeStream?.close();
      } catch (_) {
        /* ignore */
      }
      await setupPollingFallback(io, col);
    }
    return;
  }

  // --- Listen for changes ---
  changeStream.on("change", async (change) => {
    try {
      const updatedFields = change.updateDescription?.updatedFields || {};

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
          const requestKey = Object.keys(updatedFields).find((k) =>
            k.startsWith("serviceRequestInfo."),
          );
          const newRequest = updatedFields[requestKey];

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
          const serviceKey = Object.keys(updatedFields).find((k) =>
            k.startsWith("services."),
          );
          const newService = updatedFields[serviceKey];

          const provider = await col.findOne(
            { _id: change.documentKey._id },
            { projection: { email: 1, serviceProviderName: 1 } },
          );

          if (!provider) return;

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

  // --- Error handling with retry / fallback ---
  changeStream.on("error", (err) => {
    console.error("Change stream error:", err);
    try {
      changeStream.close();
    } catch (closeErr) {
      console.error("Error closing change stream:", closeErr);
    }
    if (retryCount < MAX_RETRIES) {
      const nextRetry = retryCount + 1;
      const delay = Math.min(1000 * Math.pow(2, nextRetry), 10000);
      console.log(`Attempting to re-establish change stream in ${delay}ms...`);
      setTimeout(() => setupChangeStream(io, col, nextRetry), delay);
    } else {
      console.error("Max retries reached. Falling back to polling.");
      setupPollingFallback(io, col);
    }
  });

  changeStream.on("close", () => {
    console.warn("Change stream closed.");
    if (retryCount < MAX_RETRIES) {
      console.log("Attempting to re-establish...");
      setTimeout(() => setupChangeStream(io, col, retryCount + 1), 1000);
    } else {
      console.error(
        "Max retries reached after close events. Falling back to polling.",
      );
      setupPollingFallback(io, col);
    }
  });
}

// =========================================================================
//  Public API
// =========================================================================

/**
 * Start watching the collection for changes.
 * Returns a cleanup function that clears the polling timer (if active).
 *
 * @param {import("socket.io").Server} io   – Socket.IO server instance
 * @param {import("mongodb").Collection} col – MongoDB collection to watch
 * @returns {Promise<() => void>} cleanup function
 */
export async function startWatcher(io, col) {
  await setupChangeStream(io, col);

  // Return a cleanup function for graceful shutdown
  return () => {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
      console.log("🔄 Polling timer cleared.");
    }
  };
}
