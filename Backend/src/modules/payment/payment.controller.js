// controllers/payment.controller.js
import { findById, findOne, update } from "../../DB/db.services.js";
import operationModel from "../../DB/models/operation.model.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import PaymobService from "../../utils/paymentServices.js";


const paymobService = new PaymobService();

export const initiateCardPayment = asyncHandler(async (req, res, next) => {
  const { operationID } = req.body;
  const user = req.user;


  const operation = await findById({
    model: operationModel,
    id: operationID
  })


  const FetchedTotalPrice = operation._doc.totalPrice;
  // console.log({FetchedTotalPrice , operation})
  if (!FetchedTotalPrice || FetchedTotalPrice <= 0) {
    return next(new Error("Valid total price is required", { cause: 400 }));
  }

  // Prepare billing data
  const billingData = {
    first_name: user.name?.split(' ')[0] || "Customer",
    last_name: user.name?.split(' ').slice(1).join(' ') || ".",
    email: user.email || "customer@example.com",
    phone_number: "+201234567890",
    street: "NA",
    building: "NA",
    floor: "NA",
    apartment: "NA",
    city: "Cairo",
    country: "EG",
    postal_code: "00000"
  };

  const paymentResult = await paymobService.initiateCardPayment(
    FetchedTotalPrice,
    billingData
  );

  if (!paymentResult.success) {
    return next(new Error(`Payment initiation failed: ${paymentResult.error}`, { cause: 400 }));
  }

  const updataedPaymet = await update({
    model: operationModel,
    filter: { _id: operation._id },
    data: {
      paymentReference: paymentResult.orderId.toString(),
      paymentToken: paymentResult.paymentToken,
      paymentStatus: 'pending',
    }
  })

  res.status(200).json({
    success: true,
    message: "Payment initiated successfully",
    data: {
      // orderId: paymentResult.orderId,
      // paymentToken: paymentResult.paymentToken,
      iframeUrl: paymentResult.iframeUrl,
      // paymentMethod: paymentResult.paymentMethod
      operation: updataedPaymet
    }
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
    first_name: user.name?.split(' ')[0] || "Customer",
    last_name: user.name?.split(' ').slice(1).join(' ') || ".",
    email: user.email || "customer@example.com",
    phone_number: phoneNumber || "+2011577894",
    street: "NA",
    building: "NA",
    floor: "NA",
    apartment: "NA",
    city: "Cairo",
    country: "EG",
    postal_code: "00000"
  };

  const paymentResult = await paymobService.initiateWalletPayment(
    totalPrice,
    billingData,
  );

  if (!paymentResult.success) {
    return next(new Error(`Wallet payment initiation failed: ${paymentResult.error}`, { cause: 400 }));
  }

  res.status(200).json({
    success: true,
    message: "Wallet payment initiated successfully",
    data: {
      orderId: paymentResult.orderId,
      redirectUrl: paymentResult.redirectUrl,
      paymentMethod: paymentResult.paymentMethod
    }
  });
});

export const handlePaymentCallback = asyncHandler(async (req, res, next) => {
  const callbackData = req.query;

  console.log("Payment callback received:", callbackData);

  // Verify the transaction
  const isValid = paymobService.verifyCallback(callbackData);

  if (!isValid) {
    return next(new Error("Invalid payment callback", { cause: 400 }));
  }

  // Extract important data from callback
  const {
    success,
    amount_cents,
    order_id,
    transaction_id,
    currency,
    created_at,
    pending,
    success: isSuccess
  } = callbackData;

  const paymentStatus = isSuccess === "true" ? "success" :
    pending === "true" ? "pending" : "failed";

  // Here you would typically update your database with the payment status
  // await updateOrderPaymentStatus(order_id, paymentStatus, transaction_id);

  res.status(200).json({
    success: true,
    message: `Payment ${paymentStatus}`,
    data: {
      orderId: order_id,
      transactionId: transaction_id,
      amount: amount_cents / 100, // Convert back to regular currency
      currency,
      status: paymentStatus,
      timestamp: created_at
    }
  });
});

export const getPaymentStatus = asyncHandler(async (req, res, next) => {
  const { orderId } = req.params;

  if (!orderId) {
    return next(new Error("Order ID is required", { cause: 400 }));
  }

  // Here you would typically fetch payment status from your database
  // const paymentStatus = await getOrderPaymentStatus(orderId);

  // For now, returning a mock response
  res.status(200).json({
    success: true,
    message: "Payment status retrieved",
    data: {
      orderId,
      status: "pending", // This would come from your database
      lastUpdated: new Date().toISOString()
    }
  });
});


export const PaymentPaymobWebhook = asyncHandler(async (req, res, next) => {
  const {
    order: orderData,
    id: transactionId,
    success,
    pending,
    is_voided,
    is_refunded,
    amount_cents,
    currency
  } = req.body.obj


  const paymobOrderId = orderData?.id || orderData;

  if (!paymobOrderId) {
    throw new Error("Order ID not found in webhook data");
  }

  const selectOperation = await findOne(
    {
      model : operationModel , 
      filter : {
        paymentReference : paymobOrderId.toString()
      }
    }
  )

  const updatedOperation = await update({
    model: operationModel,
    filter: { _id: selectOperation._id },
    data: {
      paymentStatus: "paid"
    }
  })

  res.status(200).json({
    status: "success",
    message: "Webhook processed"
  });
})



export const responcecallback = async function (req, res, next) {
  try {
    // ⚠️ Verify HMAC for security (this prevents fake redirects)
    const isValid = paymobService.verifyCallback(req.query);

    if (!isValid) {
      console.error('Invalid HMAC in callback - possible tampering');
      return res.redirect(`${process.env.FRONTEND_URL}/payment-success?status=error`);
    }

    const { success, pending, order: paymobOrderId, id: transactionId } = req.query;
    
    // Redirect based on transaction status
    if (success === 'true' && pending === 'false') {
      // Payment successful
      return res.redirect(`${process.env.FRONTEND_URL}/payment-success?status=success&transactionId=${transactionId}`);
    } else if (pending === 'true') {
      // Payment pending
      return res.redirect(`${process.env.FRONTEND_URL}/payment-success?status=pending`);
    } else {
      // Payment failed
      return res.redirect(`${process.env.FRONTEND_URL}/payment-success?status=failed`);
    }
  } catch (error) {
    console.error('Callback error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/payment-success?status=error`);
  }
};