import operationModel from '../../DB/models/operation.model.js';
import { operationStatusEnum, operationTypeEnum } from '../../enum.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { findByIdAndUpdate, softDelete } from '../../DB/db.services.js';
import userModel from '../../DB/models/User.model.js';
import bookmodel from '../../DB/models/bookmodel.js';
import {
  validateActiveStatus,
  validateBookTransactionType,
  validateDuplicateOperation,
  validateOperationOwnership,
  validateBorrowAvailability,
} from './operationValidation.service.js';
import { successResponce } from '../../utils/Response.js';
import { AppError } from '../../utils/AppError.js';
import { NotificationInstance } from '../../Gateways/notification.instance.js';
import Report from '../../DB/models/report.model.js';

// Helper Functions
const findBookById = async (bookId) => await bookmodel.findById(bookId);
const findUserById = async (userId) => await userModel.findById(userId);

// @desc    Get all operations
// @route   GET /api/operations
export const getAllOperation = asyncHandler(async (req, res) => {
  const operations = await operationModel
    .find({ isDeleted: false })
    .populate('user_src', 'firstName secondName email')
    .populate('user_dest', 'firstName secondName email')
    .populate('book_src_id', 'title author')
    .populate('book_dest_id', 'title author');

  return successResponce({
    res,
    status: 200,
    message: 'All operations retrieved successfully',
    data: operations,
  });
});

// Helper function to check user's previous reports
const checkUserReports = async (reporterId, targetUserId, bookId) => {
  const results = {
    hasBookReport: false,
    hasUserReport: false,
    warningMessage: null,
  };

  // 1️⃣ Check for reports on the BOOK itself
  const bookReport = await Report.findOne({
    reporterId,
    targetType: 'Book',
    targetId: bookId,
    status: { $ne: 'Cancelled' },
    isDeleted: false,
  });

  if (bookReport) {
    results.hasBookReport = true;
    return results;
  }

  // 2️⃣ Check for reports on the BOOK OWNER (user)
  const userReport = await Report.findOne({
    reporterId,
    targetType: 'user',
    targetId: targetUserId,
    status: { $ne: 'Cancelled' },
    isDeleted: false,
  });

  if (userReport) {
    results.hasUserReport = true;
    results.warningMessage = `⚠️ Warning: You have previously reported the owner of this book (${userReport.reason}). Please reconsider your decision.`;
  }

  return results;
};

// ✅ NEW: Check for report warnings before creating operation
// @desc    Check if user has reported book owner
// @route   POST /api/operations/check-report
export const checkReportBeforeOperation = asyncHandler(async (req, res) => {
  const { user_dest, book_dest_id } = req.body;
  const user_src = req.user._id;

  if (!user_dest || !book_dest_id) {
    throw new AppError('user_dest and book_dest_id are required.', 400);
  }

  // Check for previous reports using existing helper function
  const reportCheck = await checkUserReports(user_src, user_dest, book_dest_id);

  // 1️⃣ If user reported the BOOK itself → BLOCK completely
  if (reportCheck.hasBookReport) {
    throw new AppError('Cannot create operation on a book you have previously reported.', 400);
  }

  // 2️⃣ If user only reported the BOOK OWNER → Return warning
  return successResponce({
    res,
    status: 200,
    message: 'Check completed',
    data: {
      hasWarning: reportCheck.hasUserReport,
      warningMessage: reportCheck.warningMessage,
    },
  });
});

// @desc    Create new operation (buy / exchange / borrow / donate)
// @route   POST /api/operations
export const createOperation = asyncHandler(async (req, res) => {
  const { user_dest, book_src_id, book_dest_id, startDate, endDate, numberOfDays, operationType } =
    req.validatedBody;

  const user_src = req.user._id;
  const srcUser = await findUserById(user_src);

  if (user_src.toString() === user_dest.toString()) {
    throw new AppError('You cannot perform an operation with yourself.', 400);
  }

  const destUser = await findUserById(user_dest);
  if (!destUser) {
    throw new AppError('Destination user does not exist.', 404);
  }

  const mainBook = await findBookById(book_dest_id);
  if (!mainBook) {
    throw new AppError('Requested book does not exist.', 404);
  }

  // ✅ Check for previous reports (blocking only if book is reported)
  const reportCheck = await checkUserReports(user_src, user_dest, book_dest_id);

  // If user reported the BOOK itself → BLOCK completely
  if (reportCheck.hasBookReport) {
    throw new AppError('Cannot create operation on a book you have previously reported.', 400);
  }

  // Note: Warning for user reports is handled by /check-report endpoint

  const exchangeBook =
    operationType === 'exchange' && book_src_id ? await findBookById(book_src_id) : null;

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

  if (book_src_id && operationType === 'exchange') {
    newOperationData.book_src_id = book_src_id;
  }

  // ---------------- ✅ BORROW VALIDATION + TOTAL PRICE ----------------
  if (operationType === 'borrow') {
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
        throw new AppError('Start date cannot be in the past.', 400);
      }

      if (end <= start) {
        throw new AppError('End date must be after start date.', 400);
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
      throw new AppError('Start & end dates are required to check availability.', 400);
    } else {
      throw new AppError('Borrow duration (dates) is required.', 400);
    }

    newOperationData.totalPrice = pricePerDay * days;
  }

  // ---------------- BUY TOTAL PRICE ----------------
  if (operationType === 'buy') {
    const bookPrice = Number(mainBook.Price) || 0;
    newOperationData.totalPrice = bookPrice;
  }

  const newOperation = await operationModel.create(newOperationData);

  await NotificationInstance.send({
    fromUserId: user_src,
    toUserId: user_dest,
    invitationType: 'operation_request',
    message: `You have a new ${operationType} request from ${srcUser.firstName} ${srcUser.secondName} on the book "${mainBook.Title}"`,
    metadata: {
      operationId: newOperation._id.toString(),
      bookId: book_dest_id.toString(),
      type: operationType,
    },
  });

  // Simple response without warning (checked earlier)
  return successResponce({
    res,
    status: 201,
    message: 'Operation created successfully',
    data: newOperation,
  });
});

// @desc    Update operation status
// @route   PUT /api/operations/:id
export const updateOperation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const value = req.validatedBody;

  const updated = await findByIdAndUpdate({
    model: operationModel,
    id,
    data: value,
    options: { new: true },
  });

  if (!updated) {
    throw new AppError('Operation not found.', 404);
  }

  if (value.status === 'completed') {
    await NotificationInstance.send({
      fromUserId: req.user._id,
      toUserId: updated.user_src.toString(),
      invitationType: 'payment_required',
      message: `Your ${updated.operationType} request has been accepted. Complete payment now.`,
      type: 'payment',
      metadata: {
        operationID: updated._id.toString(),
        amount: updated.totalPrice,
      },
    });
  }

  return successResponce({
    res,
    status: 200,
    message: 'Operation updated successfully',
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
    throw new AppError('Operation not found.', 404);
  }

  return successResponce({
    res,
    status: 200,
    message: 'Operation deleted successfully',
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
    .populate('book_dest_id', '_id Title')
    .select('book_dest_id status operationType');

  return successResponce({
    res,
    status: 200,
    message: 'User operations retrieved successfully',
    data: operations,
  });
});


/// @desc    Get books where user is the source (books user owns/offered in operations)
// @route   GET /api/operations/my-books-as-source
export const getMyBooksAsSource = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const operations = await operationModel
    .find({
      user_src: userId,
      isDeleted: false,
      status: operationStatusEnum.COMPLETED,
      paymentStatus : "paid"
    })
    .populate('book_dest_id', 'Title Description image categoryId UserID Price PricePerDay TransactionType')
    .populate('user_dest', 'firstName secondName email profilePic')
    .select('book_dest_id user_dest operationType status createdAt updatedAt totalPrice startDate endDate numberOfDays paymentStatus')
    .sort({ createdAt: -1 })
    .lean();

  // Group operations by book
  const booksMap = new Map();

  operations.forEach(op => {
    if (op.book_dest_id) {
      const bookId = op.book_dest_id._id.toString();
      
      if (!booksMap.has(bookId)) {
        booksMap.set(bookId, {
          ...op.book_dest_id,
          operations: []
        });
      }
      
      // Calculate price per day for borrow operations
      let pricePerDay = 0;
      if (op.operationType === 'borrow' && op.numberOfDays && op.totalPrice) {
        pricePerDay = (op.totalPrice / op.numberOfDays).toFixed(2);
      } else if (op.operationType === 'borrow' && op.book_dest_id.PricePerDay) {
        pricePerDay = op.book_dest_id.PricePerDay;
      }

      // Add detailed operation info
      booksMap.get(bookId).operations.push({
        _id: op._id,
        operationType: op.operationType,
        status: op.status,
        totalPrice: op.totalPrice || 0,
        recipient: {
          _id: op.user_dest._id,
          name: `${op.user_dest.firstName} ${op.user_dest.secondName}`,
          email: op.user_dest.email,
          profilePic: op.user_dest.profilePic
        },
        // For borrow operations
        borrowDetails: op.operationType === 'borrow' ? {
          startDate: op.startDate,
          endDate: op.endDate,
          numberOfDays: op.numberOfDays || 0,
          pricePerDay: Number(pricePerDay),
          totalPrice: op.totalPrice || 0
        } : null,
        // For buy/sell operations
        saleDetails: op.operationType === 'buy' ? {
          salePrice: op.totalPrice || op.book_dest_id.Price || 0,
          soldTo: `${op.user_dest.firstName} ${op.user_dest.secondName}`,
          soldAt: op.createdAt
        } : null,
        // For donate operations
        donationDetails: op.operationType === 'donate' ? {
          donatedTo: `${op.user_dest.firstName} ${op.user_dest.secondName}`,
          donatedAt: op.createdAt
        } : null,
        // For exchange operations
        exchangeDetails: op.operationType === 'exchange' ? {
          exchangedWith: `${op.user_dest.firstName} ${op.user_dest.secondName}`,
          exchangedAt: op.createdAt
        } : null,
        paymentStatus: op.paymentStatus || 'pending',
        transactionDate: op.createdAt,
        completedAt: op.updatedAt
      });
    }
  });

  const books = Array.from(booksMap.values()).map(item => ({
    _id: item._id,
    Title: item.Title,
    Description: item.Description,
    image: item.image,
    categoryId: item.categoryId,
    UserID: item.UserID,
    TransactionType: item.TransactionType,
    totalOperations: item.operations.length,
    totalRevenue: item.operations.reduce((sum, op) => sum + (op.totalPrice || 0), 0),
    operations: item.operations
  }));

  return successResponce({
    res,
    status: 200,
    message: 'Your books as source retrieved successfully',
    data: {
      books,
      summary: {
        totalBooks: books.length,
        totalOperations: operations.length,
        totalRevenue: books.reduce((sum, book) => sum + book.totalRevenue, 0)
      }
    },
  });
});

// @desc    Get books where user is the destination (books others are offering to user)
// @route   GET /api/operations/my-books-as-dest
export const getMyBooksAsDest = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const operations = await operationModel
    .find({
      user_dest: userId,
      isDeleted: false,
      status: operationStatusEnum.COMPLETED,
      paymentStatus : "paid"
    })
    .populate('book_dest_id', 'Title Description image categoryId UserID Price PricePerDay TransactionType')
    .populate('user_src', 'firstName secondName email profilePic')
    .select('book_dest_id user_src operationType status createdAt updatedAt totalPrice startDate endDate numberOfDays paymentStatus')
    .sort({ createdAt: -1 })
    .lean();

  // Group operations by book
  const booksMap = new Map();

  operations.forEach(op => {
    if (op.book_dest_id) {
      const bookId = op.book_dest_id._id.toString();
      
      if (!booksMap.has(bookId)) {
        booksMap.set(bookId, {
          ...op.book_dest_id,
          operations: []
        });
      }
      
      // Calculate price per day for borrow operations
      let pricePerDay = 0;
      if (op.operationType === 'borrow' && op.numberOfDays && op.totalPrice) {
        pricePerDay = (op.totalPrice / op.numberOfDays).toFixed(2);
      } else if (op.operationType === 'borrow' && op.book_dest_id.PricePerDay) {
        pricePerDay = op.book_dest_id.PricePerDay;
      }

      // Add detailed operation info
      booksMap.get(bookId).operations.push({
        _id: op._id,
        operationType: op.operationType,
        status: op.status,
        totalPrice: op.totalPrice || 0,
        provider: {
          _id: op.user_src._id,
          name: `${op.user_src.firstName} ${op.user_src.secondName}`,
          email: op.user_src.email,
          profilePic: op.user_src.profilePic
        },
        // For borrow operations
        borrowDetails: op.operationType === 'borrow' ? {
          startDate: op.startDate,
          endDate: op.endDate,
          numberOfDays: op.numberOfDays || 0,
          pricePerDay: Number(pricePerDay),
          totalPrice: op.totalPrice || 0,
          borrowedFrom: `${op.user_src.firstName} ${op.user_src.secondName}`
        } : null,
        // For buy operations
        purchaseDetails: op.operationType === 'buy' ? {
          purchasePrice: op.totalPrice || op.book_dest_id.Price || 0,
          boughtFrom: `${op.user_src.firstName} ${op.user_src.secondName}`,
          purchasedAt: op.createdAt
        } : null,
        // For donate operations
        donationDetails: op.operationType === 'donate' ? {
          donatedBy: `${op.user_src.firstName} ${op.user_src.secondName}`,
          donatedAt: op.createdAt
        } : null,
        // For exchange operations
        exchangeDetails: op.operationType === 'exchange' ? {
          exchangedWith: `${op.user_src.firstName} ${op.user_src.secondName}`,
          exchangedAt: op.createdAt
        } : null,
        paymentStatus: op.paymentStatus || 'pending',
        transactionDate: op.createdAt,
        receivedAt: op.updatedAt
      });
    }
  });

  const books = Array.from(booksMap.values()).map(item => ({
    _id: item._id,
    Title: item.Title,
    Description: item.Description,
    image: item.image,
    categoryId: item.categoryId,
    UserID: item.UserID,
    TransactionType: item.TransactionType,
    totalOperations: item.operations.length,
    totalSpent: item.operations.reduce((sum, op) => sum + (op.totalPrice || 0), 0),
    operations: item.operations
  }));

  return successResponce({
    res,
    status: 200,
    message: 'Books received from others retrieved successfully',
    data: {
      books,
      summary: {
        totalBooks: books.length,
        totalOperations: operations.length,
        totalSpent: books.reduce((sum, book) => sum + book.totalSpent, 0),
        byOperationType: {
          purchased: operations.filter(op => op.operationType === 'buy').length,
          borrowed: operations.filter(op => op.operationType === 'borrow').length,
          donated: operations.filter(op => op.operationType === 'donate').length,
          exchanged: operations.filter(op => op.operationType === 'exchange').length
        }
      }
    },
  });
});