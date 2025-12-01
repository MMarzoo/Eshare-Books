import operationModel from "../../DB/models/operation.model.js";
import { operationStatusEnum } from "../../enum.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { findByIdAndUpdate, softDelete } from "../../DB/db.services.js";
import userModel from "../../DB/models/User.model.js";
import bookmodel from "../../DB/models/bookmodel.js";
import {
  validateActiveStatus,
  validateBookTransactionType,
  validateDuplicateOperation,
  validateOperationOwnership,
  validateBorrowAvailability,
} from "./operationValidation.service.js";
import { successResponce } from "../../utils/Response.js";
import { AppError } from "../../utils/AppError.js";
import { NotificationInstance } from "../../Gateways/notification.instance.js";
import { getUserSockets } from "../../middelwares/socket.auth.middleware.js";

// Helper Functions
const findBookById = async (bookId) => await bookmodel.findById(bookId);
const findUserById = async (userId) => await userModel.findById(userId);

// @desc    Get all operations
// @route   GET /api/operations
export const getAllOperation = asyncHandler(async (req, res) => {
  const operations = await operationModel
    .find({ isDeleted: false })
    .populate("user_src", "firstName secondName email")
    .populate("user_dest", "firstName secondName email")
    .populate("book_src_id", "title author")
    .populate("book_dest_id", "title author");

  return successResponce({
    res,
    status: 200,
    message: "All operations retrieved successfully",
    data: operations,
  });
});

// @desc    Create new operation (buy / exchange / borrow / donate)
// @route   POST /api/operations
export const createOperation = asyncHandler(async (req, res) => {
  const {
    user_dest,
    book_src_id,
    book_dest_id,
    startDate,
    endDate,
    numberOfDays,
    operationType,
  } = req.validatedBody;

  const user_src = req.user._id;
  const srcUser = await findUserById(user_src);

  if (user_src.toString() === user_dest.toString()) {
    throw new AppError("You cannot perform an operation with yourself.", 400);
  }

  const destUser = await findUserById(user_dest);
  if (!destUser) {
    throw new AppError("Destination user does not exist.", 404);
  }

  const mainBook = await findBookById(book_dest_id);
  if (!mainBook) {
    throw new AppError("Requested book does not exist.", 404);
  }

  const exchangeBook =
    operationType === "exchange" && book_src_id
      ? await findBookById(book_src_id)
      : null;

  await validateBookTransactionType({
    operationType,
    srcBook: mainBook,
    destBook: exchangeBook,
  });

  await validateOperationOwnership({
    operationType,
    user_src,
    user_dest,
    srcBook: mainBook,
    destBook: exchangeBook,
  });

  await validateActiveStatus({
    operationType,
    book_src_id,
    book_dest_id,
  });

  await validateDuplicateOperation({
    user_src,
    user_dest,
    book_src_id,
    book_dest_id,
    operationType,
  });

  const newOperationData = {
    user_src,
    user_dest,
    book_dest_id,
    operationType,
  };

  if (book_src_id && operationType === "exchange") {
    newOperationData.book_src_id = book_src_id;
  }

  // BORROW VALIDATION + TOTAL PRICE
  if (operationType === "borrow") {
    let days = 0;
    const pricePerDay = Number(mainBook.PricePerDay) || 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);

      if (start < today) {
        throw new AppError("Start date cannot be in the past.", 400);
      }

      if (end <= start) {
        throw new AppError("End date must be after start date.", 400);
      }

      await validateBorrowAvailability({
        bookId: book_dest_id,
        startDate,
        endDate,
      });

      const diffTime = end - start;
      days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      newOperationData.startDate = startDate;
      newOperationData.endDate = endDate;
      newOperationData.numberOfDays = days;
    } else if (numberOfDays) {
      throw new AppError(
        "Start & end dates are required to check availability.",
        400
      );
    } else {
      throw new AppError("Borrow duration (dates) is required.", 400);
    }

    newOperationData.totalPrice = pricePerDay * days;
  }

  // BUY TOTAL PRICE
  if (operationType === "buy") {
    const bookPrice = Number(mainBook.Price) || 0;
    newOperationData.totalPrice = bookPrice;
  }

  const newOperation = await operationModel.create(newOperationData);

  await NotificationInstance.send({
    fromUserId: user_src,
    toUserId: user_dest,
    invitationType: "operation_request",
    message: `You have a new ${operationType} request from ${srcUser.firstName} ${srcUser.secondName} on the book "${mainBook.Title}"`,
    metadata: {
      operationId: newOperation._id.toString(),
      bookId: book_dest_id.toString(),
      type: operationType,
    },
  });

  return successResponce({
    res,
    status: 201,
    message: "Operation created successfully",
    data: newOperation,
  });
});

// @desc    Update operation status
// @route   PUT /api/operations/:id
export const updateOperation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const value = req.validatedBody;

  // Populate all important fields before notifications
  const updated = await operationModel
    .findByIdAndUpdate(id, value, { new: true })
    .populate("book_dest_id", "Title Price")
    .populate("user_dest", "_id firstName secondName email")
    .populate("user_src", "_id firstName secondName email");

  if (!updated) {
    throw new AppError("Operation not found.", 404);
  }

  // Notification when operation is completed but payment is still pending
  if (updated.status === "completed" && updated.paymentStatus === "pending") {
    await NotificationInstance.send({
      fromUserId: req.user._id,
      toUserId: updated.user_dest?._id?.toString(),
      invitationType: "payment_required",
      message: `Your ${updated.operationType} request for the book "${updated.book_dest_id?.Title}" has been accepted. Please complete payment.`,
      type: "payment",
      metadata: {
        operationID: updated._id.toString(),
        amount: updated.totalPrice,
      },
    });
  }

  // ✅ Notification when payment is completed
  // Note: This is handled by the webhook, not here
  // The webhook will send notifications to both seller and buyer

  return successResponce({
    res,
    status: 200,
    message: "Operation updated successfully",
    data: updated,
  });
});

// @desc    Soft delete an operation
// @route   DELETE /api/operations/:id
export const deleteOperation = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const deleted = await softDelete({
    model: operationModel,
    filter: { _id: id },
    options: { new: true },
  });

  if (!deleted) {
    throw new AppError("Operation not found.", 404);
  }

  return successResponce({
    res,
    status: 200,
    message: "Operation deleted successfully",
    data: deleted,
  });
});

// @desc    Get user operations
// @route   GET /api/operations/user
export const getUserOperations = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const operations = await operationModel
    .find({
      $or: [{ user_src: userId }, { user_dest: userId }],
      isDeleted: false,
    })
    .populate("book_dest_id", "_id Title")
    .select("book_dest_id status operationType");

  return successResponce({
    res,
    status: 200,
    message: "User operations retrieved successfully",
    data: operations,
  });
});
