import "dotenv/config";
import { getCollection } from "./db.js";

const col = await getCollection("serviceProviders");
console.log("Collection obtained, testing change stream...");

try {
  const cs = col.watch([], { fullDocument: "updateLookup" });
  const result = await cs.tryNext();
  console.log("✅ Change stream works! tryNext result:", result);
  await cs.close();
} catch (e) {
  console.error("❌ Change stream failed:", e.message);
  console.error("Error code:", e.code);
  console.error("Error name:", e.name);
}

process.exit(0);
