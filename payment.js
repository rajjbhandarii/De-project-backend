import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import { getCollection } from "./db.js";

const paymentRouter = express.Router();

// Initialize Razorpay instance using env vars
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/* --------------------------------------------------
   POST /payment/create-order
   Body: { amount, currency, userEmail, requestServiceId, providerEmail, serviceName }
   Creates a Razorpay order and returns the order details + public key.
-------------------------------------------------- */
paymentRouter.post("/payment/create-order", async (req, res) => {
  try {
    const {
      amount,          // in rupees (we convert to paise)
      currency = "INR",
      userEmail,
      requestServiceId,
      providerEmail,
      serviceName,
    } = req.body;

    if (!amount || !userEmail || !requestServiceId) {
      return res.status(400).json({
        message: "amount, userEmail, and requestServiceId are required",
      });
    }

    const amountInPaise = Math.round(Number(amount) * 100);

    if (isNaN(amountInPaise) || amountInPaise <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const options = {
      amount: amountInPaise,
      currency,
      receipt: `rcpt_${requestServiceId}`.slice(0, 40), // Razorpay receipt max 40 chars
      notes: {
        userEmail,
        requestServiceId,
        providerEmail: providerEmail || "",
        serviceName: serviceName || "",
      },
    };

    const order = await razorpay.orders.create(options);

    console.log(`💳 Razorpay order created: ${order.id} for ₹${amount}`);

    res.json({
      orderId: order.id,
      amount: order.amount,       // in paise
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Error creating Razorpay order:", err);
    res.status(500).json({ message: "Failed to create payment order" });
  }
});

/* --------------------------------------------------
   POST /payment/verify
   Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature,
           userEmail, providerEmail, requestServiceId, amount, currency, serviceName }
   Verifies HMAC-SHA256 signature and saves payment record.
-------------------------------------------------- */
paymentRouter.post("/payment/verify", async (req, res) => {
  try {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      userEmail,
      providerEmail,
      requestServiceId,
      amount,
      currency,
      serviceName,
    } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ message: "Missing payment verification fields" });
    }

    // Verify signature: HMAC-SHA256(orderId + "|" + paymentId, key_secret)
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      console.warn("⚠️  Payment signature mismatch!");
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    // Save payment record to MongoDB
    const paymentsCol = await getCollection("payments");
    const paymentRecord = {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      userEmail,
      providerEmail: providerEmail || "",
      requestServiceId,
      serviceName: serviceName || "",
      amount: Number(amount),     // stored in paise
      currency: currency || "INR",
      status: "paid",
      createdAt: new Date(),
    };

    await paymentsCol.insertOne(paymentRecord);

    console.log(`✅ Payment verified & saved: ${razorpayPaymentId} for request ${requestServiceId}`);

    res.json({ success: true, paymentId: razorpayPaymentId });
  } catch (err) {
    console.error("Error verifying payment:", err);
    res.status(500).json({ success: false, message: "Failed to verify payment" });
  }
});

/* --------------------------------------------------
   GET /payment/history?email=user@example.com
   Returns all payment records for a given user email.
-------------------------------------------------- */
paymentRouter.get("/payment/history", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ message: "email query param is required" });
    }

    const paymentsCol = await getCollection("payments");
    const payments = await paymentsCol
      .find({ userEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(payments);
  } catch (err) {
    console.error("Error fetching payment history:", err);
    res.status(500).json({ message: "Failed to fetch payment history" });
  }
});

export default paymentRouter;
