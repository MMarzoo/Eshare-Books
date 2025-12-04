import suggestCategoryModel from '../../DB/models/suggest-category.model.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponce } from '../../utils/Response.js';
import { AppError } from '../../utils/AppError.js';
import categoryModel from '../../DB/models/category.model.js';
import { getNotificationService } from '../../Gateways/soketio.gateway.js';

// @desc    Get all suggested categories (non-deleted only) - Admin only
// @route   GET /api/suggest-categories
export const getAllSuggestedCategories = asyncHandler(async (req, res) => {
  const categories = await suggestCategoryModel
    .find({})
    .populate('suggestedBy', 'firstName secondName email')
    .sort({ createdAt: -1 });

  return successResponce({
    res,
    status: 200,
    message: 'Suggested categories retrieved successfully',
    data: categories,
  });
});

// @desc    Get suggested category by id (non-deleted only) - Admin only
// @route   GET /api/suggest-categories/:id
export const getSuggestedCategoryById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const category = await suggestCategoryModel
    .findOne({ _id: id, isDeleted: false })
    .populate('suggestedBy', 'firstName secondName email');

  if (!category) {
    return next(new AppError('Suggested category not found', 404));
  }

  return successResponce({
    res,
    message: 'Suggested category retrieved successfully',
    data: category,
  });
});

// @desc    Create suggested category - Any authenticated user
// @route   POST /api/suggest-categories
export const createSuggestedCategory = asyncHandler(async (req, res, next) => {
  const { name } = req.body;
  const trimmedName = name.trim();

  // تحويل الاسم للصيغة الصغيرة للتحقق غير الحساس لحالة الأحرف
  const lowercaseName = trimmedName.toLowerCase();

  // التحقق من أن المستخدم لم يقترح نفس الفئة من قبل (بغض النظر عن حالة الأحرف)
  const existingSuggestion = await suggestCategoryModel.findOne({
    $or: [
      { name: trimmedName, suggestedBy: req.user._id, isDeleted: false },
      {
        name: { $regex: new RegExp(`^${trimmedName}$`, 'i') }, // regex غير حساس لحالة الأحرف
        suggestedBy: req.user._id,
        isDeleted: false,
      },
    ],
  });

  if (existingSuggestion) {
    return next(new AppError('You have already suggested this category before', 400));
  }

  // التحقق إذا كانت الفئة موجودة بالفعل في الفئات الرئيسية (بغض النظر عن حالة الأحرف)
  const existingCategory = await categoryModel.findOne({
    name: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    isDeleted: false,
  });

  if (existingCategory) {
    return next(new AppError('This category already exists in main categories', 400));
  }

  const newCategory = await suggestCategoryModel.create({
    name: trimmedName,
    suggestedBy: req.user._id,
  });

  await newCategory.populate('suggestedBy', 'firstName secondName email');

  return successResponce({
    res,
    status: 201,
    message: 'Category suggestion created successfully',
    data: newCategory,
  });
});

// @desc    Delete suggested category (soft delete) - Admin only
// @route   DELETE /api/suggest-categories/:id
export const deleteSuggestedCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const deleted = await suggestCategoryModel
    .findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() }, { new: true })
    .populate('suggestedBy', 'firstName secondName email');

  if (!deleted) {
    return next(new AppError('Suggested category not found', 404));
  }

  return successResponce({
    res,
    message: 'Suggested category deleted successfully',
    data: deleted,
  });
});
// @desc    Accept suggested category (Add to main categories) - Admin only
// @route   PATCH /api/suggest-categories/:id/accept
export const acceptSuggestedCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // 1. البحث عن الاقتراح والتأكد من وجوده
  const suggestedCategory = await suggestCategoryModel
    .findOne({
      _id: id,
      isDeleted: false,
    })
    .populate('suggestedBy', 'firstName secondName email'); // إضافة populate

  if (!suggestedCategory) {
    return next(new AppError('Suggested category not found or already processed', 404));
  }

  // التحقق إذا كان الاقتراح مرفوضاً مسبقاً
  if (suggestedCategory.status === 'rejected') {
    return next(new AppError('This suggestion has already been rejected', 400));
  }

  // التحقق إذا كان الاقتراح مقبولاً مسبقاً
  if (suggestedCategory.status === 'accepted') {
    return next(new AppError('This suggestion has already been accepted', 400));
  }

  // 2. التحقق من عدم وجود الفئة في الفئات الرئيسية بنفس الاسم
  const existingCategory = await categoryModel.findOne({
    name: suggestedCategory.name,
    isDeleted: false,
  });

  if (existingCategory) {
    return next(new AppError('Category with this name already exists in main categories', 400));
  }

  // 3. التحقق من وجود الفئة محذوفة مسبقاً بنفس الاسم (للاستعادة)
  const existingDeletedCategory = await categoryModel.findOne({
    name: suggestedCategory.name,
    isDeleted: true,
  });

  let createdCategory;
  let isRestored = false;

  if (existingDeletedCategory) {
    // إذا كانت الفئة موجودة لكن محذوفة، نستعيدها
    existingDeletedCategory.isDeleted = false;
    existingDeletedCategory.deletedAt = null;
    await existingDeletedCategory.save();
    createdCategory = existingDeletedCategory;
    isRestored = true;
  } else {
    // إذا لم تكن موجودة، ننشئ فئة جديدة
    createdCategory = await categoryModel.create({
      name: suggestedCategory.name,
    });
  }

  // 4. تحديث حالة الاقتراح
  const updatedSuggestion = await suggestCategoryModel
    .findByIdAndUpdate(
      id,
      {
        isDeleted: true,
        deletedAt: new Date(),
        status: 'accepted',
        acceptedAt: new Date(),
      },
      { new: true }
    )
    .populate('suggestedBy', 'firstName secondName email');

  // 5. ✅ إرسال إشعار للمستخدم الذي اقترح الفئة
  await sendCategorySuggestionNotification(suggestedCategory.suggestedBy._id, 'accepted', {
    suggestionId: suggestedCategory._id,
    categoryName: suggestedCategory.name,
    action: isRestored ? 'restored' : 'created',
    newCategoryId: createdCategory._id,
    adminId: req.user._id,
  });

  // 6. إرجاع الرد المناسب
  return successResponce({
    res,
    status: 200,
    message: 'Category suggestion accepted and added to main categories successfully',
    data: {
      suggestion: {
        id: updatedSuggestion._id,
        name: updatedSuggestion.name,
        status: updatedSuggestion.status,
        acceptedAt: updatedSuggestion.acceptedAt,
        suggestedBy: updatedSuggestion.suggestedBy,
      },
      category: {
        id: createdCategory._id,
        name: createdCategory.name,
        isRestored: isRestored,
        action: isRestored ? 'restored' : 'created',
      },
    },
  });
});

// @desc    Reject suggested category - Admin only
// @route   PATCH /api/suggest-categories/:id/reject
export const rejectSuggestedCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { rejectionReason } = req.body;

  // 1. البحث عن الاقتراح والتأكد من وجوده
  const suggestedCategory = await suggestCategoryModel
    .findOne({
      _id: id,
      isDeleted: false,
    })
    .populate('suggestedBy', 'firstName secondName email'); // إضافة populate

  if (!suggestedCategory) {
    return next(new AppError('Suggested category not found or already processed', 404));
  }

  // التحقق إذا كان الاقتراح مرفوضاً مسبقاً
  if (suggestedCategory.status === 'rejected') {
    return next(new AppError('This suggestion has already been rejected', 400));
  }

  // التحقق إذا كان الاقتراح مقبولاً مسبقاً
  if (suggestedCategory.status === 'accepted') {
    return next(new AppError('This suggestion has already been accepted', 400));
  }

  // 2. التحقق من طول سبب الرفض إذا تم إرساله
  if (rejectionReason && rejectionReason.trim().length < 5) {
    return next(
      new AppError('Rejection reason must be at least 5 characters long if provided', 400)
    );
  }

  // 3. تحديث الاقتراح برفضه
  const updateData = {
    isDeleted: true,
    deletedAt: new Date(),
    status: 'rejected',
    rejectedAt: new Date(),
  };

  if (rejectionReason && rejectionReason.trim() !== '') {
    updateData.rejectionReason = rejectionReason.trim();
  }

  const rejectedCategory = await suggestCategoryModel
    .findByIdAndUpdate(id, updateData, { new: true })
    .populate('suggestedBy', 'firstName secondName email');

  // 4. ✅ إرسال إشعار للمستخدم الذي اقترح الفئة
  await sendCategorySuggestionNotification(suggestedCategory.suggestedBy._id, 'rejected', {
    suggestionId: suggestedCategory._id,
    categoryName: suggestedCategory.name,
    rejectionReason: rejectionReason || 'No reason provided',
    adminId: req.user._id,
  });

  // 5. إرجاع الرد المناسب
  return successResponce({
    res,
    status: 200,
    message: 'Category suggestion rejected successfully',
    data: {
      id: rejectedCategory._id,
      name: rejectedCategory.name,
      status: rejectedCategory.status,
      suggestedBy: rejectedCategory.suggestedBy,
      rejectedAt: rejectedCategory.deletedAt,
      rejectionReason: rejectedCategory.rejectionReason || 'No reason provided',
    },
  });
});

/**
 * ✅ دالة مساعدة لإرسال إشعارات اقتراح الفئة
 */
const sendCategorySuggestionNotification = async (userId, action, data) => {
  try {
    const notificationService = getNotificationService();

    if (!notificationService) {
      console.error('❌ Notification service not available for category suggestion');
      return;
    }

    const messageType =
      action === 'accepted' ? 'category_suggestion_accepted' : 'category_suggestion_rejected';

    const title =
      action === 'accepted' ? 'Category Suggestion Accepted' : 'Category Suggestion Rejected';

    let message = '';
    if (action === 'accepted') {
      message = `Your category suggestion "${data.categoryName}" has been accepted and ${
        data.action === 'restored' ? 'restored in' : 'added to'
      } the main categories.`;
    } else {
      message = `Your category suggestion "${data.categoryName}" has been rejected.`;
      if (data.rejectionReason && data.rejectionReason !== 'No reason provided') {
        message += ` Reason: ${data.rejectionReason}`;
      }
    }

    const notificationData = {
      type: messageType,
      title,
      message,
      userId: userId.toString(), // أضف userId هنا
      read: false, // أضف حالة القراءة
      data: {
        suggestionId: data.suggestionId.toString(),
        categoryName: data.categoryName,
        action: action,
        ...(action === 'accepted' && {
          newCategoryId: data.newCategoryId.toString(),
          isRestored: data.action === 'restored',
        }),
        ...(action === 'rejected' && {
          rejectionReason: data.rejectionReason,
        }),
        adminId: data.adminId.toString(),
        timestamp: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    };

    // ✅ إرسال إشعار واحد فقط
    const result = await notificationService.emitToUser(
      userId.toString(),
      'category-suggestion-updated',
      notificationData
    );

    console.log(`✅ Category suggestion ${action} notification sent to user: ${userId}`);
    return { success: true, userId, action, result };
  } catch (error) {
    console.error(`❌ Error sending category suggestion ${action} notification:`, error);
    return { success: false, error: error.message };
  }
};
