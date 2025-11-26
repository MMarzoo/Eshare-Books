import Book from '../../DB/models/bookmodel.js';
import cloudinary from '../../utils/file Uploadind/cloudinaryConfig.js';
import streamifier from 'streamifier';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { nanoid } from 'nanoid';
import { moderateImage, moderateText } from '../../utils/ai/moderation.js';
import mongoose from 'mongoose';

// 👇 إضافة موديل العمليات + الـ enums
import Operation from '../../DB/models/operation.model.js';
import { operationStatusEnum, operationTypeEnum } from '../../enum.js';
import categoryModel from '../../DB/models/category.model.js';

// Helper Function: Upload to Cloudinary
const uploadToCloudinary = (fileBuffer, folder) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream({ folder }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

// Helper Function: Delete from Cloudinary
const deleteFromCloudinary = async (fileUrl) => {
  try {
    const parts = fileUrl.split('/');
    const fileName = parts[parts.length - 1].split('.')[0];
    const folderPath = parts.slice(parts.indexOf('Books')).slice(0, -1).join('/');
    const publicId = `${folderPath}/${fileName}`;

    await cloudinary.uploader.destroy(publicId);
    console.log(`🗑️ Deleted from Cloudinary: ${publicId}`);
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
  }
};

/* ──────────────────────────────
   📘 Add New Book (with Gemini AI Moderation)
────────────────────────────── */
export const addBook = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const data = req.body;
  const customId = nanoid(6);
  let uploadedImage = null;

  try {
    // ─────────────────────────────────
    // 1️⃣ Validate Required Fields First
    // ─────────────────────────────────
    if (!data.Title || data.Title.trim() === '') {
      throw new AppError('❌ Title is required', 400);
    }

    if (!data.categoryId) {
      throw new AppError('❌ Category is required', 400);
    }

    if (!data.TransactionType) {
      throw new AppError('❌ Transaction type is required', 400);
    }

    const validTransactionTypes = ['toSale', 'toBorrow', 'toExchange', 'toDonate'];
    if (!validTransactionTypes.includes(data.TransactionType)) {
      throw new AppError(
        `❌ Invalid transaction type. Must be one of: ${validTransactionTypes.join(', ')}`,
        400
      );
    }

    // Validate Price for toSale
    if (data.TransactionType === 'toSale' && (!data.Price || data.Price < 1)) {
      throw new AppError('❌ Price is required and must be at least 1 for sale transactions', 400);
    }

    // ─────────────────────────────────
    // 2️⃣ Moderate Text Content (Title + Description)
    // ─────────────────────────────────
    console.log('🔍 Step 1: Moderating text content...');

    const textToModerate = `${data.Title || ''}\n${data.Description || ''}`.trim();
    const textModeration = await moderateText(textToModerate);

    console.log('📝 Text moderation result:', textModeration);

    if (textModeration.flagged) {
      return res.status(400).json({
        success: false,
        message: `🚫 Book rejected: ${
          textModeration.reason || 'Text contains inappropriate content'
        }`,
        details: {
          source: textModeration.source,
          type: 'text_violation',
        },
      });
    }

    console.log('✅ Text moderation passed');

    // ─────────────────────────────────
    // 3️⃣ Upload and Moderate Image (if provided)
    // ─────────────────────────────────
    if (req.file) {
      console.log('🖼️ Step 2: Processing and moderating image...');

      try {
        // Upload image to Cloudinary
        const folderPath = `Books/${userId}/book_${customId}`;
        const upload = await uploadToCloudinary(req.file.buffer, folderPath);

        uploadedImage = {
          secure_url: upload.secure_url,
          public_id: upload.public_id,
        };

        console.log('☁️ Image uploaded to Cloudinary:', uploadedImage.public_id);

        // Moderate the uploaded image
        console.log('🔍 Moderating image content...');
        const imageModeration = await moderateImage(uploadedImage.secure_url);

        console.log('🖼️ Image moderation result:', imageModeration);

        if (!imageModeration.safe) {
          // Delete flagged image from Cloudinary
          console.log('🗑️ Deleting inappropriate image from Cloudinary...');
          await deleteFromCloudinary(uploadedImage.secure_url);

          return res.status(400).json({
            success: false,
            message: `🚫 Book rejected: ${
              imageModeration.reason || 'Image contains inappropriate content'
            }`,
            details: {
              source: imageModeration.source,
              type: 'image_violation',
            },
          });
        }

        console.log('✅ Image moderation passed');
      } catch (imageError) {
        console.error('❌ Image processing error:', imageError);

        // Cleanup uploaded image if error occurs
        if (uploadedImage?.public_id) {
          try {
            await deleteFromCloudinary(uploadedImage.secure_url);
            console.log('🗑️ Cleaned up image after error');
          } catch (cleanupError) {
            console.error('Failed to cleanup image:', cleanupError);
          }
        }

        throw new AppError('❌ Failed to process image. Please try again.', 500);
      }
    } else {
      console.log('ℹ️ No image provided, skipping image moderation');
    }

    // ─────────────────────────────────
    // 4️⃣ Create Book in Database
    // ─────────────────────────────────
    console.log('💾 Step 3: Creating book in database...');

    const bookData = {
      Title: data.Title.trim(),
      Description: data.Description?.trim() || '',
      categoryId: data.categoryId,
      UserID: userId,
      TransactionType: data.TransactionType,
      IsModerated: true,
      isDeleted: false,
    };

    // Add image if uploaded
    if (uploadedImage) {
      bookData.image = uploadedImage;
    }

    // Add Price for sale transactions
    if (data.TransactionType === 'toSale') {
      bookData.Price = parseFloat(data.Price);
    }

    // Add PricePerDay for borrow transactions (optional)
    if (data.TransactionType === 'toBorrow' && data.PricePerDay) {
      bookData.PricePerDay = parseFloat(data.PricePerDay);
    }

    const newBook = await Book.create(bookData);

    // Populate user and category for response
    await newBook.populate('UserID', 'firstName secondName email avatar name');
    await newBook.populate('categoryId', 'name');

    console.log('✅ Book created successfully:', newBook._id);

    // ─────────────────────────────────
    // 5️⃣ Return Success Response
    // ─────────────────────────────────
    res.status(201).json({
      success: true,
      message: '✅ Book added successfully (AI Approved)',
      book: {
        _id: newBook._id,
        Title: newBook.Title,
        Description: newBook.Description,
        categoryId: newBook.categoryId,
        TransactionType: newBook.TransactionType,
        Price: newBook.Price,
        PricePerDay: newBook.PricePerDay,
        image: newBook.image,
        IsModerated: newBook.IsModerated,
        UserID: newBook.UserID,
        createdAt: newBook.createdAt,
        updatedAt: newBook.updatedAt,
      },
    });
  } catch (error) {
    console.error('❌ Error adding book:', error);

    // Cleanup uploaded image on any error
    if (uploadedImage?.public_id) {
      try {
        await deleteFromCloudinary(uploadedImage.secure_url);
        console.log('🗑️ Cleaned up uploaded image after error');
      } catch (cleanupError) {
        console.error('Failed to cleanup image:', cleanupError);
      }
    }

    // Pass to error handler middleware
    next(error);
  }
});

/* ──────────────────────────────
   📘 Get All Books (Home) + Pagination
   - Ignore Deleted
   - Hide sold/donated books (buy/donate + completed)
   - Mark borrowed now (borrow + completed & date in range)
────────────────────────────── */
export const getAllBooks = asyncHandler(async (req, res, next) => {
  let { title, page = 1, limit = 10 } = req.query;

  const filter = { isDeleted: false, IsModerated: true };
  if (title) filter.Title = { $regex: title, $options: 'i' };

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;
  const skip = (pageNum - 1) * limitNum;
  const now = new Date();

  // 1️⃣ الكتب اللي اتباعت أو اتمدت (BUY + DONATE مكتملة)
  const soldBookIds = await Operation.distinct('book_dest_id', {
    operationType: { $in: [operationTypeEnum.BUY, operationTypeEnum.DONATE] },
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
  });

  // 2️⃣ عمليات الـ BORROW النشطة حاليًا
  const activeBorrowOps = await Operation.find({
    operationType: operationTypeEnum.BORROW,
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).select('book_dest_id');

  const activeBorrowIds = new Set(activeBorrowOps.map((op) => op.book_dest_id.toString()));

  // 3️⃣ نجيب الكتب اللي مش متباعة/متمدية – الأحدث أولاً
  const books = await Book.find({
    ...filter,
    _id: { $nin: soldBookIds },
  })
    .populate('UserID', 'firstName secondName email avatar name')
    .populate('categoryId', 'name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  // 4️⃣ فلاغ availability
  const booksWithAvailability = books.map((book) => ({
    ...book,
    isBorrowedNow: activeBorrowIds.has(book._id.toString()),
  }));

  const count = await Book.countDocuments({
    ...filter,
    _id: { $nin: soldBookIds },
  });

  res.json({
    message: '✅ Books fetched successfully',
    total: count,
    page: pageNum,
    limit: limitNum,
    books: booksWithAvailability,
  });
});

/* ──────────────────────────────
   📘 Get All Books (Including Deleted, Sold, Donated)
   - Returns all books without exceptions
   - Includes deleted, sold, and donated books
   - Useful for admin management and analytics
────────────────────────────── */
export const getAllBooksIncludingAll = asyncHandler(async (req, res, next) => {
  let {
    title,
    page = 1,
    limit = 10,
    includeDeleted = true,
    category,
    status,
    transactionType,
  } = req.query;

  const filter = {};

  if (title) filter.Title = { $regex: title, $options: 'i' };
  if (category) filter.categoryId = category;
  if (transactionType) filter.TransactionType = transactionType;
  if (includeDeleted === 'false') filter.isDeleted = false;

  const pageNum = Number(page) || 1;
  const limitNum = Number(limit) || 10;
  const skip = (pageNum - 1) * limitNum;
  const now = new Date();

  // Get all candidate books (no skip/limit) — we'll paginate after computing status
  const books = await Book.find(filter)
    .populate('UserID', 'firstName secondName email profilePic fullName')
    .populate('categoryId', 'name')
    .sort({ createdAt: -1 })
    .lean();

  // Get sold/donated/active borrow IDs (distinct is more efficient)
  const soldIdsArr = await Operation.distinct('book_dest_id', {
    operationType: { $in: [operationTypeEnum.BUY] },
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
  });

  const donatedIdsArr = await Operation.distinct('book_dest_id', {
    operationType: { $in: [operationTypeEnum.DONATE] },
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
  });

  const activeBorrowOps = await Operation.find({
    operationType: operationTypeEnum.BORROW,
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).select('book_dest_id startDate endDate');

  const soldIds = new Set(soldIdsArr.map((id) => id?.toString()));
  const donatedIds = new Set(donatedIdsArr.map((id) => id?.toString()));
  const activeBorrowIds = new Set(activeBorrowOps.map((op) => op.book_dest_id.toString()));

  // Apply status filter in-memory (correct result set)
  let booksToProcess = books;
  if (status) {
    booksToProcess = books.filter((book) => {
      if (!book._id) return false;
      const bookId = book._id.toString();
      switch (status) {
        case 'sold':
          return soldIds.has(bookId);
        case 'donated':
          return donatedIds.has(bookId);
        case 'borrowed':
          return activeBorrowIds.has(bookId);
        case 'available':
          return (
            !soldIds.has(bookId) &&
            !donatedIds.has(bookId) &&
            !activeBorrowIds.has(bookId) &&
            !book.isDeleted
          );
        case 'deleted':
          return !!book.isDeleted;
        default:
          return true;
      }
    });
  }

  // Map status flags
  const booksWithStatus = booksToProcess.map((book) => {
    const bookId = book._id ? book._id.toString() : null;
    const isSold = bookId ? soldIds.has(bookId) : false;
    const isDonated = bookId ? donatedIds.has(bookId) : false;
    const isBorrowedNow = bookId ? activeBorrowIds.has(bookId) : false;

    let computedStatus = 'available';
    if (book.isDeleted) computedStatus = 'deleted';
    else if (isSold) computedStatus = 'sold';
    else if (isDonated) computedStatus = 'donated';
    else if (isBorrowedNow) computedStatus = 'borrowed';

    return {
      ...book,
      isSold,
      isDonated,
      isBorrowedNow,
      status: computedStatus,
    };
  });

  // Pagination (slice after all filters are applied)
  const count = booksWithStatus.length;
  const paginatedBooks = booksWithStatus.slice(skip, skip + limitNum);

  res.json({
    message: '✅ All books fetched successfully (including deleted, sold, donated)',
    total: count,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(count / limitNum),
    includeDeleted: includeDeleted !== 'false',
    books: paginatedBooks,
  });
});

/* ──────────────────────────────
   📘 Get Books by Category
   - نفس منطق availability + إخفاء الكتب المباعة/المتمدية
   - Only return books with IsModerated: true
────────────────────────────── */
export const getBooksByCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const now = new Date();

  const soldBookIds = await Operation.distinct('book_dest_id', {
    operationType: { $in: [operationTypeEnum.BUY, operationTypeEnum.DONATE] },
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
  });

  const activeBorrowOps = await Operation.find({
    operationType: operationTypeEnum.BORROW,
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).select('book_dest_id');

  const activeBorrowIds = new Set(activeBorrowOps.map((op) => op.book_dest_id.toString()));

  const books = await Book.find({
    categoryId,
    isDeleted: false,
    IsModerated: true, // ⬅️ نضيف الشرط هنا
    _id: { $nin: soldBookIds },
  })
    .populate('UserID', 'firstName secondName email avatar name')
    .populate('categoryId', 'name')
    .lean();

  const booksWithAvailability = books.map((book) => ({
    ...book,
    isBorrowedNow: activeBorrowIds.has(book._id.toString()),
  }));

  res.json({
    message: '✅ Books fetched successfully for this category',
    total: booksWithAvailability.length,
    books: booksWithAvailability,
  });
});

/* ──────────────────────────────
   📘 Get Book by ID
   - يخفي الكتب اللي اتباعت أو اتمدت (BUY / DONATE + COMPLETED)
   - يعلّم الكتب المستعارة حاليًا بـ isBorrowedNow + currentBorrow
   - Only return books with IsModerated: true
────────────────────────────── */
export const getBookById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const now = new Date();

  // 1️⃣ لو فيه عملية BUY أو DONATE مكتملة على الكتاب → اعتبره غير موجود
  const soldOrDonatedOp = await Operation.findOne({
    book_dest_id: id,
    operationType: { $in: [operationTypeEnum.BUY, operationTypeEnum.DONATE] },
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
  });

  if (soldOrDonatedOp) {
    throw new AppError('❌ Book not found', 404);
  }

  // 2️⃣ هل فيه عملية BORROW نشطة حاليًا على الكتاب؟
  const activeBorrowOp = await Operation.findOne({
    book_dest_id: id,
    operationType: operationTypeEnum.BORROW,
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
    startDate: { $lte: now },
    endDate: { $gte: now },
  });

  // 3️⃣ نجيب الكتاب نفسه مع شرط IsModerated
  const bookDoc = await Book.findOne({
    _id: id,
    isDeleted: false,
    IsModerated: true, // ⬅️ نضيف الشرط هنا
  })
    .populate('UserID', 'firstName secondName email avatar name')
    .populate('categoryId', 'name');

  if (!bookDoc) throw new AppError('❌ Book not found', 404);

  // 4️⃣ نضيف فلاغ isBorrowedNow + مدة الاستعارة (لو موجودة)
  const book = bookDoc.toObject();
  book.isBorrowedNow = !!activeBorrowOp;
  book.currentBorrow = activeBorrowOp
    ? {
        startDate: activeBorrowOp.startDate,
        endDate: activeBorrowOp.endDate,
      }
    : null;

  res.json({ message: '✅ Book fetched successfully', book });
});

/* ──────────────────────────────
   📘 Update Book
────────────────────────────── */
export const updateBook = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const book = await Book.findOne({ _id: id, isDeleted: false });
  if (!book) throw new AppError('❌ Book not found', 404);

  if (book.UserID.toString() !== userId.toString()) {
    throw new AppError('⛔ Unauthorized to edit this book', 403);
  }

  if (req.file) {
    if (book.image?.public_id) {
      await cloudinary.uploader.destroy(book.image.public_id);
    }
    const upload = await uploadToCloudinary(req.file.buffer, `Books/${userId}/book_${nanoid(6)}`);
    req.body.image = {
      secure_url: upload.secure_url,
      public_id: upload.public_id,
    };
  }

  const updatedBook = await Book.findByIdAndUpdate(id, req.body, { new: true });
  res.json({ message: '✅ Book updated successfully', book: updatedBook });
});

/* ──────────────────────────────
   📘 Soft Delete Book
────────────────────────────── */
export const deleteBook = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const book = await Book.findOne({ _id: id, isDeleted: false });
  if (!book) throw new AppError('❌ Book not found', 404);

  if (book.UserID.toString() !== userId.toString()) {
    throw new AppError('⛔ Unauthorized to delete this book', 403);
  }

  book.isDeleted = true;
  await book.save();
  res.json({ message: '✅ Book deleted successfully' });
});

/* ──────────────────────────────
   📘 Get Books by Transaction Type
   - تستخدم في الفلتر by type في Home
   - نفس منطق الكتب المباعة + الاستعارة
────────────────────────────── */
export const getBooksByTransactionType = asyncHandler(async (req, res) => {
  const { type } = req.params; // toSale / toBorrow / ...

  const validTypes = ['toSale', 'toBorrow', 'toExchange', 'toDonate'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({
      success: false,
      message: '❌ Invalid transaction type.',
      allowedTypes: validTypes,
    });
  }

  const now = new Date();

  const soldBookIds = await Operation.distinct('book_dest_id', {
    operationType: { $in: [operationTypeEnum.BUY, operationTypeEnum.DONATE] },
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
  });

  const activeBorrowOps = await Operation.find({
    operationType: operationTypeEnum.BORROW,
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
    startDate: { $lte: now },
    endDate: { $gte: now },
  }).select('book_dest_id');

  const activeBorrowIds = new Set(activeBorrowOps.map((op) => op.book_dest_id.toString()));

  const books = await Book.find({
    TransactionType: type,
    isDeleted: false,
    _id: { $nin: soldBookIds },
  })
    .populate('UserID', 'firstName secondName email avatar name')
    .populate('categoryId', 'name')
    .lean();

  const booksWithAvailability = books.map((book) => ({
    ...book,
    isBorrowedNow: activeBorrowIds.has(book._id.toString()),
  }));

  res.json({
    success: true,
    message: `✅ Books fetched successfully for type: ${type}`,
    total: booksWithAvailability.length,
    books: booksWithAvailability,
  });
});

/* ──────────────────────────────
   📘 Get Books by UserId
   - Only return books with IsModerated: true
   - Hide sold/donated books (BUY/DONATE + COMPLETED)
────────────────────────────── */
export const getBooksByUserId = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError('❌ Invalid user ID', 400);
  }

  // 1️⃣ نجيب الـ IDs للكتب اللي اتباعت أو اتمدت (BUY + DONATE مكتملة)
  const soldOrDonatedBookIds = await Operation.distinct('book_dest_id', {
    operationType: { $in: [operationTypeEnum.BUY, operationTypeEnum.DONATE] },
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
  });

  // 2️⃣ نجيب الكتب مع الفلترة
  const books = await Book.find({
    UserID: userId,
    isDeleted: false,
    IsModerated: true, // ⬅️ بس الكتب المعمولها moderation
    _id: { $nin: soldOrDonatedBookIds }, // ⬅️ ما نرجعش الكتب المباعة/المتمدية
  })
    .populate('UserID', 'firstName secondName email avatar name')
    .populate('categoryId', 'name')
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    message: '✅ Books fetched successfully for this user',
    total: books.length,
    books,
  });
});

/* ──────────────────────────────
   👑 Admin: Delete Any Book
   - Allows admin to delete any book regardless of owner
   - Uses soft delete to maintain records
────────────────────────────── */
export const adminDeleteBook = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const book = await Book.findOne({ _id: id, isDeleted: false });
  if (!book) {
    throw new AppError('❌ Book not found', 404);
  }

  // Soft delete the book
  book.isDeleted = true;
  await book.save();

  res.json({
    success: true,
    message: '✅ Book deleted successfully by admin',
    deletedBook: {
      id: book._id,
      title: book.Title,
      deletedBy: req.user._id,
    },
  });
});

/* ──────────────────────────────
   👑 Admin: Update Book Moderation Status
   - Allows admin to change book moderation status
   - Admin can set IsModerated to true or false
────────────────────────────── */
export const adminUpdateModeration = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { IsModerated } = req.body;

  // Validate required field
  if (typeof IsModerated === 'undefined') {
    throw new AppError('❌ IsModerated field is required', 400);
  }

  // Validate boolean value
  if (typeof IsModerated !== 'boolean') {
    throw new AppError('❌ IsModerated must be a boolean value (true or false)', 400);
  }

  const book = await Book.findOne({ _id: id, isDeleted: false });
  if (!book) {
    throw new AppError('❌ Book not found', 404);
  }

  // Update moderation status
  book.IsModerated = IsModerated;
  await book.save();

  res.json({
    success: true,
    message: `✅ Book moderation status updated to ${IsModerated}`,
    book: {
      id: book._id,
      title: book.Title,
      IsModerated: book.IsModerated,
      updatedBy: req.user._id,
      updatedAt: new Date(),
    },
  });
});

/* ──────────────────────────────
   👑 Admin: Restore Deleted Book
   - Allows admin to restore any soft-deleted book
   - Useful for recovering accidentally deleted books
────────────────────────────── */
export const adminRestoreBook = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const book = await Book.findById(id);
  if (!book) throw new AppError('Book not found', 404);

  if (!book.isDeleted) {
    return res.status(400).json({
      success: false,
      message: 'Book is not deleted',
    });
  }

  // ممنوع ترستور كتاب اتباع أو اتمدى
  const soldOrDonated = await Operation.findOne({
    book_dest_id: id,
    operationType: { $in: [operationTypeEnum.BUY, operationTypeEnum.DONATE] },
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
  });

  if (soldOrDonated) {
    return res.status(400).json({
      success: false,
      message: 'Cannot restore a book that has been sold or donated',
    });
  }

  book.isDeleted = false;
  await book.save();

  res.json({
    success: true,
    message: 'Book restored successfully by admin',
    restoredBook: { id: book._id, title: book.Title },
  });
});

/* ──────────────────────────────
   👑 Admin: Update Book Category
   - Allows admin to change book category
   - Useful for correcting misclassified books
────────────────────────────── */
export const adminUpdateBookCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { categoryId } = req.body;

  // ─────────────────────────────────
  // 1️⃣ Validate Required Fields
  // ─────────────────────────────────
  if (!categoryId) {
    throw new AppError('❌ categoryId is required', 400);
  }

  // Validate categoryId format
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw new AppError('❌ Invalid category ID format', 400);
  }

  // ─────────────────────────────────
  // 2️⃣ Check if Category Exists and Not Deleted
  // ─────────────────────────────────
  const category = await categoryModel.findOne({
    _id: categoryId,
    isDeleted: false,
  });

  if (!category) {
    throw new AppError('❌ Category not found or has been deleted', 404);
  }

  // ─────────────────────────────────
  // 3️⃣ Check if Book Exists and Not Deleted
  // ─────────────────────────────────
  const book = await Book.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!book) {
    throw new AppError('❌ Book not found or has been deleted', 404);
  }

  // ─────────────────────────────────
  // 4️⃣ Check if Book is Sold or Donated
  // ─────────────────────────────────
  const soldOrDonated = await Operation.findOne({
    book_dest_id: id,
    operationType: { $in: [operationTypeEnum.BUY, operationTypeEnum.DONATE] },
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
  });

  if (soldOrDonated) {
    throw new AppError('❌ Cannot update category for a book that has been sold or donated', 400);
  }

  // ─────────────────────────────────
  // 5️⃣ Update Book Category
  // ─────────────────────────────────
  const oldCategoryId = book.categoryId;

  book.categoryId = categoryId;
  await book.save();

  // Populate the updated book for response
  await book.populate('UserID', 'firstName secondName email avatar name');
  await book.populate('categoryId', 'name');

  // ─────────────────────────────────
  // 6️⃣ Return Success Response
  // ─────────────────────────────────
  res.json({
    success: true,
    message: '✅ Book category updated successfully',
    book: {
      id: book._id,
      title: book.Title,
      oldCategory: oldCategoryId,
      newCategory: {
        id: category._id,
        name: category.name,
      },
      updatedBy: req.user._id,
      updatedAt: new Date(),
    },
  });
});
