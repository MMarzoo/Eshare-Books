// routes/payment.routes.js
import { Router } from "express";
import { 
  initiateCardPayment, 
  initiateWalletPayment, 
  handlePaymentCallback,
  getPaymentStatus, 
  PaymentPaymobWebhook,
  responcecallback
} from "./payment.controller.js";
import { auth } from "../../middelwares/auth.middleware.js";


const router = Router();
// Proccesd callback
router.post("/callback", PaymentPaymobWebhook);
router.get("/webhook" , responcecallback)
router.post("/card", auth, initiateCardPayment);
router.post("/wallet", auth, initiateWalletPayment);
router.get("/status/:orderId", auth, getPaymentStatus);

// Public callback route (Paymob will call this)
router.get("/callback", handlePaymentCallback);

export default router;