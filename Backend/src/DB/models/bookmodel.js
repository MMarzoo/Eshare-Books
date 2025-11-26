import mongoose from "mongoose";
// ✅ Max limits
const MAX_SALE_PRICE = 100000;
const MAX_BORROW_PRICE_PER_DAY = 500;
const bookSchema = new mongoose.Schema(
  {
    // ISBN: {
    //   type: String,
    //   required: true,
    //   unique: true,
    //   trim: true,
    // },
    Title: {
      type: String,
      required: true,
      trim: true,
    },
    Description: {
      type: String,
      trim: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "category", // reference
      required: true,
    },
    IsModerated: {
      type: Boolean,
      default: false,
    },
    UserID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    // Condition: {
    //   type: String,
    //   enum: ["New", "Like New", "Used", "Very Used"],
    //   default: "Used",
    // },
    TransactionType: {
      type: String,
      enum: ["toSale", "toBorrow", "toExchange", "toDonate"],
      required: true,
      default: "toSale",
    },
    image: {
      secure_url: { type: String },
      public_id: { type: String },
    },
    // Image: {
    //   type: String, // store image URL or file path
    //   trim: true,
    // },
    Price: {
      type: Number,
      // required: true,
      min: 1,
      max: MAX_SALE_PRICE, // ✅ max sale price
    },
    PricePerDay: {
      type: Number,
      min: 1,
      max: MAX_BORROW_PRICE_PER_DAY, // ✅ max borrow per day
    },
    // ✅ Soft Delete flag
    isDeleted: {
      type: Boolean,
      default: false,
    },
    // Status: {
    //   type: String,
    //   enum: ["Available", "Sold", "Reserved"],
    //   default: "Available",
    // },
  },
  { timestamps: true }
);

export default mongoose.model("Book", bookSchema);
