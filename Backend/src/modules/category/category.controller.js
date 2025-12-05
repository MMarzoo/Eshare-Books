import { findByIdAndUpdate, softDelete, update } from '../../DB/db.services.js';
import categoryModel from '../../DB/models/category.model.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponce } from '../../utils/Response.js';
import { AppError } from '../../utils/AppError.js';

// @desc    Get all categories
// @route   GET /api/categories
export const getAllCategories = asyncHandler(async (req, res) => {
  const categories = await categoryModel.find({ isDeleted: false });

  return successResponce({
    res,
    status: 200,
    message: 'Categories retrieved successfully',
    data: categories,
  });
});

// @desc    Get category by id
// @route   GET /api/categories/:id
export const getCategoryById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const category = await categoryModel.findOne({ _id: id, isDeleted: false });
  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  return successResponce({
    res,
    message: 'Category retrieved successfully',
    data: category,
  });
});

// @desc    Create category
// @route   POST /api/categories
export const createCategory = asyncHandler(async (req, res, next) => {
  const { name } = req.validatedBody;
  const trimmedName = name.trim();

  // استخدام regex للبحث غير الحساس لحالة الأحرف (case-insensitive)
  const existingActive = await categoryModel.findOne({
    name: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    isDeleted: false,
  });

  if (existingActive) {
    return next(new AppError('Category already exists', 400));
  }

  // التحقق من الفئات المحذوفة أيضاً بنفس الطريقة
  const existingDeleted = await categoryModel.findOne({
    name: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    isDeleted: true,
  });

  if (existingDeleted) {
    return next(new AppError('Category already exists but is deleted. You can restore it.', 400));
  }

  const newCategory = await categoryModel.create({ name: trimmedName });

  return successResponce({
    res,
    status: 201,
    message: 'Category created successfully',
    data: newCategory,
  });
});

// @desc    Update category
// @route   PUT /api/categories/:id
export const updateCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name } = req.validatedBody;

  // إذا كان الاسم مش متضمن في البيانات المحدثة، نفذ التحديث مباشرة
  if (!name) {
    const updated = await findByIdAndUpdate({
      model: categoryModel,
      id,
      data: req.validatedBody,
      options: { new: true },
    });

    if (!updated) {
      return next(new AppError('Category not found', 404));
    }

    return successResponce({
      res,
      message: 'Category updated successfully',
      data: updated,
    });
  }

  const trimmedName = name.trim();
  const nameLowercase = trimmedName.toLowerCase();

  // البحث عن الفئة الحالية
  const currentCategory = await categoryModel.findById(id);
  if (!currentCategory || currentCategory.isDeleted) {
    return next(new AppError('Category not found', 404));
  }

  // إذا الاسم الجديد هو نفس الاسم الحالي (case-insensitive)، نفذ التحديث مباشرة
  if (nameLowercase === currentCategory.name.toLowerCase()) {
    const updated = await findByIdAndUpdate({
      model: categoryModel,
      id,
      data: { ...req.validatedBody, name: trimmedName },
      options: { new: true },
    });

    return successResponce({
      res,
      message: 'Category updated successfully',
      data: updated,
    });
  }

  // التحقق من وجود فئة أخرى بنفس الاسم (غير حساس لحالة الأحرف)
  const existingCategory = await categoryModel.findOne({
    name: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    _id: { $ne: id },
    isDeleted: false,
  });

  if (existingCategory) {
    return next(new AppError('Category with this name already exists', 400));
  }

  // التحقق من وجود فئة محذوفة بنفس الاسم
  const existingDeleted = await categoryModel.findOne({
    name: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    _id: { $ne: id },
    isDeleted: true,
  });

  if (existingDeleted) {
    return next(
      new AppError('A deleted category with this name exists. You need to restore it first.', 400)
    );
  }

  // تنفيذ التحديث
  const updated = await findByIdAndUpdate({
    model: categoryModel,
    id,
    data: { ...req.validatedBody, name: trimmedName },
    options: { new: true },
  });

  if (!updated) {
    return next(new AppError('Category not found', 404));
  }

  // ✅ إرسال إشعارات للمستخدمين المتأثرين بتغيير اسم الفئة
  try {
    // Import النماذج المطلوبة والـ enums
    const Book = await import('../../DB/models/bookmodel.js').then((m) => m.default || m);
    const operationModel = await import('../../DB/models/operation.model.js').then(
      (m) => m.default || m
    );
    const { operationTypeEnum, operationStatusEnum } = await import('../../enum.js');
    const { getNotificationService } = await import('../../Gateways/soketio.gateway.js');

    console.log(`📢 Starting category update notifications for category ${id}`);

    // الحصول على جميع الكتب النشطة في هذه الفئة
    const booksInCategory = await Book.find({
      categoryId: id,
      isDeleted: false,
    }).select('_id UserID Title');

    console.log(`📚 Found ${booksInCategory.length} books in category "${updated.name}"`);

    if (booksInCategory.length > 0) {
      const bookIds = booksInCategory.map((book) => book._id);

      // ✅ البحث عن الكتب التي تم بيعها أو التبرع بها (نستثنيها من الإشعارات)
      // 🔴 التصحيحات الرئيسية هنا:
      const excludedOperations = await operationModel
        .find({
          book_dest_id: { $in: bookIds }, // ✅ استخدام book_dest_id بدلاً من book_src_id
          operationType: { $in: [operationTypeEnum.BUY, operationTypeEnum.DONATE] }, // ✅ استخدام enums
          status: operationStatusEnum.COMPLETED, // ✅ استخدام enum
          isDeleted: false, // ✅ إضافة فلتر isDeleted
        })
        .select('book_dest_id operationType');

      console.log(`🔍 Found ${excludedOperations.length} sold/donated operations to exclude`);

      // إنشاء Set من IDs الكتب المستثناة
      const excludedBookIds = new Set(excludedOperations.map((op) => op.book_dest_id.toString()));

      // تصفية الكتب المؤهلة للإشعارات (استثناء الكتب المباعة/المتبرع بها)
      const eligibleBooks = booksInCategory.filter(
        (book) => !excludedBookIds.has(book._id.toString())
      );

      console.log(`✅ ${eligibleBooks.length} eligible books found for notifications`);

      // الحصول على IDs المستخدمين الفريدة
      const userIds = [...new Set(eligibleBooks.map((book) => book.UserID.toString()))];

      console.log(`👥 Preparing to notify ${userIds.length} unique users`);

      // إرسال إشعار لكل مستخدم
      if (userIds.length > 0) {
        const notificationService = getNotificationService();

        for (const userId of userIds) {
          // الحصول على كتب المستخدم المتأثرة
          const userBooks = eligibleBooks.filter((book) => book.UserID.toString() === userId);

          const notificationData = {
            type: 'category_update',
            title: 'Category Name Updated',
            message: `The category "${currentCategory.name}" has been renamed to "${trimmedName}". You have ${userBooks.length} book(s) in this category.`,
            data: {
              categoryId: id,
              oldCategoryName: currentCategory.name,
              newCategoryName: trimmedName,
              affectedBooksCount: userBooks.length,
              affectedBooks: userBooks.map((book) => ({
                id: book._id,
                title: book.Title,
              })),
              updatedAt: new Date().toISOString(),
            },
          };

          // إرسال الإشعار عبر Socket.IO
          const emitResult = notificationService.emitToUser(
            userId,
            'category-updated',
            notificationData
          );

          console.log(
            `📤 Emit result for user ${userId}:`,
            emitResult.success ? 'Success' : 'Failed',
            emitResult
          );

          // حفظ الإشعار في قاعدة البيانات (اختياري)
          await notificationService.saveNotification({
            userId: userId,
            type: 'category_update',
            title: notificationData.title,
            body: notificationData.message,
            data: notificationData.data,
          });

          console.log(`✅ Category update notification sent to user ${userId}`);
        }

        console.log(
          `📢 Category update notifications sent to ${userIds.length} user(s) for ${eligibleBooks.length} eligible book(s)`
        );
      } else {
        console.log('ℹ️ No users to notify (all books are sold/donated or deleted)');
      }
    } else {
      console.log('ℹ️ No books found in this category');
    }
  } catch (notificationError) {
    // لا نريد أن يفشل التحديث بسبب فشل الإشعارات
    console.error('❌ Error sending category update notifications:', notificationError);
    console.error('Stack trace:', notificationError.stack);
    // يمكنك إضافة logging system هنا
  }

  return successResponce({
    res,
    message: 'Category updated successfully',
    data: updated,
  });
});

// @desc    Delete category
// @route   DELETE /api/categories/:id
export const deleteCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Import Book model
  const Book = await import('../../DB/models/bookmodel.js').then((m) => m.default || m);

  // Check if category contains any active books
  const activeBooksInCategory = await Book.findOne({
    categoryId: id,
    isDeleted: false,
  });

  // Prevent deletion if category contains active books
  if (activeBooksInCategory) {
    return next(
      new AppError(
        'Cannot delete category that contains active books. Please remove or reassign the books first.',
        400
      )
    );
  }

  // Perform soft delete if no active books found
  const deleted = await softDelete({
    model: categoryModel,
    filter: { _id: id },
    options: { new: true },
  });

  // Handle case where category not found
  if (!deleted) {
    return next(new AppError('Category not found', 404));
  }

  // Return success response
  return successResponce({
    res,
    message: 'Category deleted successfully',
    data: deleted,
  });
});

/* ──────────────────────────────────
   👑 Admin: Restore Deleted Category
   - Allows admin to restore any soft-deleted category
   - Useful for recovering accidentally deleted categories
────────────────────────────────── */
export const adminRestoreCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const category = await categoryModel.findById(id);
  if (!category) {
    return next(new AppError('Category not found', 404));
  }

  if (!category.isDeleted) {
    return next(new AppError('Category is not deleted', 400));
  }

  category.isDeleted = false;
  category.deletedAt = null;
  await category.save();

  return successResponce({
    res,
    status: 200,
    message: 'Category restored successfully by admin',
    data: {
      id: category._id,
      name: category.name,
      restoredAt: new Date(),
    },
  });
});

// @desc    Get all categories for admin (including deleted)
// @route   GET /api/admin/categories
export const getAllCategoriesForAdmin = asyncHandler(async (req, res) => {
  const categories = await categoryModel.find({});

  return successResponce({
    res,
    status: 200,
    message: 'All categories retrieved successfully for admin',
    data: categories,
  });
});
