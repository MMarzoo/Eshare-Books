import axios from 'axios'

class PaymobService {
  constructor() {
    this.baseURL = 'https://accept.paymob.com/api';
    this.apiKey = process.env.PAYMOB_API_KEY;

    // Multiple Integration IDs for different payment methods
    this.integrations = {
      card: {
        id: process.env.PAYMOB_CARD_INTEGRATION_ID,
        iframeId: process.env.PAYMOB_IFRAME_ID
      },
      wallet: {
        id: process.env.PAYMOB_WALLET_INTEGRATION_ID
      }
    };
  }

  // Step 1: Authentication
  async authenticate() {
    try {
      const response = await axios.post(`${this.baseURL}/auth/tokens`, {
        api_key: this.apiKey
      });
      return response.data.token;
    } catch (error) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  // Step 2: Create Order
  async createOrder(authToken, amountCents, items = []) {
    try {
      const response = await axios.post(`${this.baseURL}/ecommerce/orders`, {
        auth_token: authToken,
        delivery_needed: false,
        amount_cents: amountCents,
        currency: 'EGP',
        items: items
      });
      return response.data;
    } catch (error) {
      throw new Error(`Order creation failed: ${error.message}`);
    }
  }

  // Step 3: Generate Payment Key
  async generatePaymentKey(authToken, orderId, amountCents, billingData, paymentMethod = 'card') {
    try {
      const integrationId = this.integrations[paymentMethod].id;

      const response = await axios.post(`${this.baseURL}/acceptance/payment_keys`, {
        auth_token: authToken,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: orderId,
        billing_data: billingData,
        currency: 'EGP',
        integration_id: integrationId
      });
      return response.data.token;
    } catch (error) {
      throw new Error(`Payment key generation failed: ${error.message}`);
    }
  }

  // Complete Payment Flow for Card
  async initiateCardPayment(amount, billingData) {
    try {
      const amountCents = Math.round(amount * 100);

      // Step 1: Authenticate
      const authToken = await this.authenticate();

      // Step 2: Create Order
      const order = await this.createOrder(authToken, amountCents);

      // Step 3: Generate Payment Key
      const paymentToken = await this.generatePaymentKey(
        authToken,
        order.id,
        amountCents,
        billingData,
        'card'
      );

      // Return iframe URL for card payment
      return {
        success: true,
        orderId: order.id,
        paymentToken: paymentToken,
        paymentMethod: 'card',
        iframeUrl: `https://accept.paymob.com/api/acceptance/iframes/${this.integrations.card.iframeId}?payment_token=${paymentToken}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Complete Payment Flow for Mobile Wallet
  async initiateWalletPayment(amount, billingData, phoneNumber) {
    try {
      const amountCents = Math.round(amount * 100);

      // Step 1: Authenticate
      const authToken = await this.authenticate();

      // Step 2: Create Order
      const order = await this.createOrder(authToken, amountCents);

      // Step 3: Generate Payment Key
      const paymentToken = await this.generatePaymentKey(
        authToken,
        order.id,
        amountCents,
        billingData,
        'wallet'
      );

      // Step 4: Pay with Mobile Wallet
      const walletResponse = await axios.post(
        `${this.baseURL}/acceptance/payments/pay`,
        {
          source: {
            identifier: phoneNumber,
            subtype: 'WALLET'
          },
          payment_token: paymentToken
        }
      );

      return {
        success: true,
        orderId: order.id,
        paymentMethod: 'wallet',
        redirectUrl: walletResponse.data.redirect_url,
        data: walletResponse.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  verifyTransactionResponse(queryParams) {
  const crypto = require('crypto');
  
  // List of keys to exclude from HMAC calculation
  const excludedKeys = [
    'profile_id', 'merchant_commission', 'accept_fees', 'discount_details',
    'is_void', 'is_refund', 'refunded_amount_cents', 'captured_amount',
    'updated_at', 'is_settled', 'bill_balanced', 'is_bill',
    'data.message', 'acq_response_code', 'txn_response_code', 'hmac'
  ];
  
  // Step 1: Filter out excluded keys and hmac
  const validKeys = Object.keys(queryParams)
    .filter(key => !excludedKeys.includes(key) && key !== 'hmac');
  
  // Step 2: Sort keys lexicographically
  const sortedKeys = validKeys.sort();
  
  // Step 3: Concatenate values in sorted order
  const concatenatedString = sortedKeys
    .map(key => String(queryParams[key] ?? ''))
    .join('');
  
  // Step 4 & 5: Get secret and calculate HMAC
  const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
  if (!hmacSecret) return false;
  
  const hmac = crypto.createHmac('sha512', hmacSecret);
  const calculatedHmac = hmac.update(concatenatedString).digest('hex');
  
  // Step 6: Compare
  return calculatedHmac === queryParams.hmac;
}

  // Verify transaction callback (wrapper method for backward compatibility)
  verifyCallback(callbackData) {
    console.log('='.repeat(60));
    console.log('PAYMOB HMAC VERIFICATION');
    console.log('='.repeat(60));

    const result = this.verifyTransactionResponse(callbackData);

    console.log('='.repeat(60));
    console.log(`RESULT: ${result ? 'VALID ✅' : 'INVALID ❌'}`);
    console.log('='.repeat(60));

    return result;
  }


}

export default PaymobService