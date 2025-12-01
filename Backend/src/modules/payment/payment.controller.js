// controllers/payment.controller.js
import { findById } from "../../DB/db.services.js";
import operationModel from "../../DB/models/operation.model.js";
import { NotificationInstance } from "../../Gateways/notification.instance.js";
import { getUserSockets } from "../../middelwares/socket.auth.middleware.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import PaymobService from "../../utils/paymentServices.js";

const paymobService = new PaymobService();

export const initiateCardPayment = asyncHandler(async (req, res, next) => {
  const { operationID } = req.body;
  const user = req.user;

  const operation = await findById({
    model: operationModel,
    id: operationID,
  });

  const FetchedTotalPrice = operation._doc.totalPrice;

  if (!FetchedTotalPrice || FetchedTotalPrice <= 0) {
    return next(new Error("Valid total price is required", { cause: 400 }));
  }

  // Prepare billing data
  const billingData = {
    first_name: user.name?.split(" ")[0] || "Customer",
    last_name: user.name?.split(" ").slice(1).join(" ") || ".",
    email: user.email || "customer@example.com",
    phone_number: "+201234567890",
    street: "NA",
    building: "NA",
    floor: "NA",
    apartment: "NA",
    city: "Cairo",
    country: "EG",
    postal_code: "00000",
  };

  const paymentResult = await paymobService.initiateCardPayment(
    FetchedTotalPrice,
    billingData
  );

  if (!paymentResult.success) {
    return next(
      new Error(`Payment initiation failed: ${paymentResult.error}`, {
        cause: 400,
      })
    );
  }

  const updataedPaymet = await operationModel.findByIdAndUpdate(
    operation._id,
    {
      paymentReference: paymentResult.orderId.toString(),
      paymentToken: paymentResult.paymentToken,
      paymentStatus: "pending",
    },
    { new: true }
  );

  console.log("💾 Payment reference saved:", {
    operationId: operation._id,
    paymentReference: paymentResult.orderId.toString(),
    paymentToken: paymentResult.paymentToken,
  });

  res.status(200).json({
    success: true,
    message: "Payment initiated successfully",
    data: {
      iframeUrl: paymentResult.iframeUrl,
      operation: updataedPaymet,
    },
  });
});

export const initiateWalletPayment = asyncHandler(async (req, res, next) => {
  const { totalPrice } = req.body;
  const user = req.user;

  if (!totalPrice || totalPrice <= 0) {
    return next(new Error("Valid total price is required", { cause: 400 }));
  }

  // Prepare billing data
  const billingData = {
    first_name: user.name?.split(" ")[0] || "Customer",
    last_name: user.name?.split(" ").slice(1).join(" ") || ".",
    email: user.email || "customer@example.com",
    phone_number: phoneNumber || "+2011577894",
    street: "NA",
    building: "NA",
    floor: "NA",
    apartment: "NA",
    city: "Cairo",
    country: "EG",
    postal_code: "00000",
  };

  const paymentResult = await paymobService.initiateWalletPayment(
    totalPrice,
    billingData
  );

  if (!paymentResult.success) {
    return next(
      new Error(`Wallet payment initiation failed: ${paymentResult.error}`, {
        cause: 400,
      })
    );
  }

  res.status(200).json({
    success: true,
    message: "Wallet payment initiated successfully",
    data: {
      orderId: paymentResult.orderId,
      redirectUrl: paymentResult.redirectUrl,
      paymentMethod: paymentResult.paymentMethod,
    },
  });
});

export const handlePaymentCallback = asyncHandler(async (req, res, next) => {
  const callbackData = req.query;

  console.log("Payment callback received:", callbackData);

  const isValid = paymobService.verifyCallback(callbackData);

  if (!isValid) {
    return next(new Error("Invalid payment callback", { cause: 400 }));
  }

  const {
    success,
    amount_cents,
    order_id,
    transaction_id,
    currency,
    created_at,
    pending,
    success: isSuccess,
  } = callbackData;

  const paymentStatus =
    isSuccess === "true"
      ? "success"
      : pending === "true"
      ? "pending"
      : "failed";

  res.status(200).json({
    success: true,
    message: `Payment ${paymentStatus}`,
    data: {
      orderId: order_id,
      transactionId: transaction_id,
      amount: amount_cents / 100,
      currency,
      status: paymentStatus,
      timestamp: created_at,
    },
  });
});

export const getPaymentStatus = asyncHandler(async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId) {
    return next(new Error("Order ID is required", { cause: 400 }));
  }

  res.status(200).json({
    success: true,
    message: "Payment status retrieved",
    data: {
      orderId,
      status: "pending",
      lastUpdated: new Date().toISOString(),
    },
  });
});

export const PaymentPaymobWebhook = asyncHandler(async (req, res, next) => {
  console.log("========================================");
  console.log(
    "🎯 WEBHOOK RECEIVED - Raw Body:",
    JSON.stringify(req.body, null, 2)
  );
  console.log("========================================");

  const {
    obj: {
      order: orderData,
      id: transactionId,
      success: paymentSuccess,
      pending: paymentPending,
    },
  } = req.body;

  const paymobOrderId = orderData?.id || orderData;

  console.log("📦 Extracted Data:", {
    paymobOrderId,
    transactionId,
    paymentSuccess,
    paymentPending,
    paymentSuccessType: typeof paymentSuccess,
    paymentPendingType: typeof paymentPending,
  });

  if (!paymobOrderId) {
    console.error("❌ No order ID found in webhook");
    throw new Error("Order ID not found in webhook data");
  }

  console.log(
    "🔍 Searching for operation with paymentReference:",
    paymobOrderId.toString()
  );
  console.log("   - Type:", typeof paymobOrderId.toString());
  console.log("   - Value:", paymobOrderId.toString());

  let selectOperation = null;

  try {
    // Try to find by paymentReference
    // ✅ Fixed: Changed 'book' to 'book_dest_id'
    selectOperation = await operationModel
      .findOne({
        paymentReference: paymobOrderId.toString(),
      })
      .populate("user_src", "_id firstName secondName email")
      .populate("user_dest", "_id firstName secondName email")
      .populate("book_dest_id", "Title");

    console.log("🔎 Query executed successfully");
    console.log(
      "🔎 Query result (by paymentReference):",
      selectOperation ? "FOUND ✅" : "NOT FOUND ❌"
    );
  } catch (queryError) {
    console.error("❌ Error executing query:", queryError);
    throw queryError;
  }

  // If not found, try alternative methods
  if (!selectOperation) {
    console.log("⚠️ Not found by paymentReference, trying alternatives...");

    try {
      // Check all operations with paymentReference
      const allWithRef = await operationModel
        .find({
          paymentReference: { $exists: true },
        })
        .select("_id paymentReference paymentStatus createdAt")
        .sort({ createdAt: -1 })
        .limit(10);

      console.log(
        `📋 Found ${allWithRef.length} operations with paymentReference`
      );
      console.log(
        "📋 Operations:",
        allWithRef.map((op) => ({
          id: op._id.toString(),
          ref: op.paymentReference,
          refType: typeof op.paymentReference,
          status: op.paymentStatus,
          match: op.paymentReference === paymobOrderId.toString(),
          matchStrict: op.paymentReference === String(paymobOrderId),
        }))
      );

      // Try to find by loose matching
      const looseMatch = allWithRef.find(
        (op) => String(op.paymentReference) === String(paymobOrderId)
      );

      if (looseMatch) {
        console.log("✅ Found by loose matching:", looseMatch._id);
        selectOperation = await operationModel
          .findById(looseMatch._id)
          .populate("user_src", "_id firstName secondName email")
          .populate("user_dest", "_id firstName secondName email")
          .populate("book_dest_id", "Title");
      } else {
        console.error("❌ No match found at all!");
        throw new Error("Operation not found for this payment");
      }
    } catch (altError) {
      console.error("❌ Error in alternative search:", altError);
      throw altError;
    }
  }

  console.log("✅ Operation found:", {
    operationId: selectOperation._id,
    user_src: selectOperation.user_src?._id,
    user_dest: selectOperation.user_dest?._id,
    currentPaymentStatus: selectOperation.paymentStatus,
  });

  // 2) Determine payment status
  let paymentStatus = "pending";
  if (paymentSuccess === true || paymentSuccess === "true") {
    paymentStatus = "paid";
  } else if (paymentPending === false || paymentPending === "false") {
    paymentStatus = "failed";
  }

  console.log("💳 Determined payment status:", paymentStatus);

  // 3) Update payment status in database and get populated result
  const updatedOperation = await operationModel
    .findByIdAndUpdate(
      selectOperation._id,
      {
        paymentStatus,
        transactionId,
      },
      { new: true }
    )
    .populate("user_src", "_id firstName secondName email")
    .populate("user_dest", "_id firstName secondName email")
    .populate("book_dest_id", "Title");

  console.log("✅ Operation updated:", {
    operationId: updatedOperation._id,
    newPaymentStatus: updatedOperation.paymentStatus,
    transactionId: updatedOperation.transactionId,
  });

  // 4) Send notifications if payment successful
  console.log("🔔 Checking if should send notifications...");
  console.log("   - paymentStatus:", paymentStatus);
  console.log("   - Condition result:", paymentStatus === "paid");

  if (paymentStatus === "paid") {
    console.log("✅ Payment is PAID - Sending notifications...");
    try {
      const sellerId = updatedOperation.user_dest?._id;
      const buyerId = updatedOperation.user_src?._id;

      if (!sellerId || !buyerId) {
        console.error("❌ Missing user IDs in operation:", {
          sellerId,
          buyerId,
          operation: updatedOperation,
        });
        throw new Error("Missing user information in operation");
      }

      console.log("📤 Sending payment notifications:", {
        sellerId: sellerId.toString(),
        buyerId: buyerId.toString(),
        amount: updatedOperation.totalPrice,
      });

      // ✅ Check if users are connected via socket
      const sellerSockets = getUserSockets(sellerId);
      const buyerSockets = getUserSockets(buyerId);

      console.log("🔌 Socket connections:", {
        sellerSockets: sellerSockets.length,
        buyerSockets: buyerSockets.length,
      });

      if (sellerSockets.length === 0) {
        console.warn("⚠️ Seller is not connected to socket");
      }
      if (buyerSockets.length === 0) {
        console.warn("⚠️ Buyer is not connected to socket");
      }

      // Send notification to book owner (seller - user_dest)
      await NotificationInstance.sendPaymentReceivedNotification(
        sellerId,
        buyerId,
        updatedOperation
      );

      console.log("✅ Payment notifications sent successfully");
    } catch (notificationError) {
      console.error("❌ Failed to send notification:", notificationError);
      console.error("Stack trace:", notificationError.stack);
      // Don't stop webhook processing if notification fails
    }
  } else {
    console.log("⚠️ Payment status is NOT 'paid', skipping notifications");
    console.log("   - Current status:", paymentStatus);
  }

  console.log("========================================");
  console.log("✅ WEBHOOK PROCESSED SUCCESSFULLY");
  console.log("========================================");

  res.status(200).json({
    status: "success",
    message: "Webhook processed",
  });
});

export const responcecallback = async function (req, res, next) {
  try {
    // Verify HMAC for security (prevents fake redirects)
    const isValid = paymobService.verifyCallback(req.query);

    if (!isValid) {
      console.error("Invalid HMAC in callback - possible tampering");
      return res.redirect(
        `${process.env.FRONTEND_URL}/payment-success?status=error`
      );
    }

    const {
      success,
      pending,
      order: paymobOrderId,
      id: transactionId,
    } = req.query;

    // Redirect based on transaction status
    if (success === "true" && pending === "false") {
      return res.redirect(
        `${process.env.FRONTEND_URL}/payment-success?status=success&transactionId=${transactionId}`
      );
    } else if (pending === "true") {
      return res.redirect(
        `${process.env.FRONTEND_URL}/payment-success?status=pending`
      );
    } else {
      return res.redirect(
        `${process.env.FRONTEND_URL}/payment-success?status=failed`
      );
    }
  } catch (error) {
    console.error("Callback error:", error);
    return res.redirect(
      `${process.env.FRONTEND_URL}/payment-success?status=error`
    );
  }
};
