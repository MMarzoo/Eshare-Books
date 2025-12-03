// user.controller.js
import userModel from './../../DB/models/User.model.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponce } from '../../utils/Response.js';
import {
  findOne,
  create,
  update,
  deleteOne,
  findMany,
  findById,
  countDocuments,
  findWithPagination,
} from '../../DB/db.services.js';
import { compareHash, genrateHash } from '../../utils/secuirty/hash.services.js';
import { AppError } from '../../utils/AppError.js';
import {
  friendRequestStatusEnum,
  operationStatusEnum,
  operationTypeEnum,
  roleEnum,
} from '../../enum.js';
import bookmodel from '../../DB/models/bookmodel.js';
import operationModel from '../../DB/models/operation.model.js';
import { getNotificationService } from '../../Gateways/soketio.gateway.js';
import { sendEmailEvent } from '../../Events/sendEmail.event.js';

// Create User
export const createUser = asyncHandler(async (req, res, next) => {
  const { firstName, secondName, email, password, address, role, profilePic } = req.body;

  // Check if user already exists
  const existingUser = await findOne({
    model: userModel,
    filter: { email },
  });

  if (existingUser) {
    return next(new Error('User already exists with this email', { cause: 409 }));
  }

  // Hash password
  const hashedPassword = await genrateHash({ plainText: password, saltRound: process.env.SALT });

  // Create user
  const user = await create({
    model: userModel,
    data: {
      firstName,
      secondName,
      email,
      password: hashedPassword,
      address,
      role: role || roleEnum.user,
      profilePic,
      isConfirmed: false,
    },
  });

  // Remove password from response
  const userResponse = user.toObject();
  delete userResponse.password;

  return successResponce({
    res,
    status: 201,
    message: 'User created successfully',
    data: userResponse,
  });
});

// Get All Users (with pagination and filtering) - UPDATED
export const getUsers = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 10, search, role } = req.query;

  // Build filter
  const filter = {};

  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { secondName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  if (role && Object.values(roleEnum).includes(role)) {
    filter.role = role;
  }

  // Get users with pagination using the new service
  const result = await findWithPagination({
    model: userModel,
    filter,
    page: parseInt(page),
    limit: parseInt(limit),
    sort: { createdAt: -1 },
    select: '-password',
  });

  return successResponce({
    res,
    message: 'Users retrieved successfully',
    data: {
      users: result.data,
      pagination: result.pagination,
    },
  });
});

// Get User by ID - UPDATED
export const getUserById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const user = await findById({
    model: userModel,
    id: id,
    select: '-password',
  });

  if (!user) {
    return next(new Error('User not found', { cause: 404 }));
  }

  return successResponce({
    res,
    message: 'User retrieved successfully',
    data: user,
  });
});

// Get Current User Profile
export const getProfile = asyncHandler(async (req, res, next) => {
  const user = await findOne({
    model: userModel,
    filter: { _id: req.user._id },
    select: '-password',
  });

  if (!user) {
    return next(new Error('User not found', { cause: 404 }));
  }

  return successResponce({
    res,
    message: 'Profile retrieved successfully',
    data: user,
  });
});

// Update User - UPDATED
export const updateUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { firstName, secondName, email, address, role, profilePic } = req.body;

  // Check if user exists
  const existingUser = await findById({
    model: userModel,
    id: id,
  });

  if (!existingUser) {
    return next(new Error('User not found', { cause: 404 }));
  }

  // Check if email is being changed and if it's already taken
  if (email && email !== existingUser.email) {
    const emailExists = await findOne({
      model: userModel,
      filter: { email, _id: { $ne: id } },
    });

    if (emailExists) {
      return next(new Error('Email already taken', { cause: 409 }));
    }
  }

  // Check if role is being changed to admin
  const isRoleChangedToAdmin = role === 'admin' && existingUser.role !== 'admin';

  // Update user
  const updatedUser = await update({
    model: userModel,
    filter: { _id: id },
    data: {
      ...(firstName && { firstName }),
      ...(secondName && { secondName }),
      ...(email && { email }),
      ...(address && { address }),
      ...(role && { role }),
      ...(profilePic && { profilePic }),
    },
    options: { new: true },
  });

  // Send notification if role changed to admin
  if (isRoleChangedToAdmin) {
    try {
      const notificationService = getNotificationService();

      if (notificationService) {
        await notificationService.emitToUser(id, 'role-updated', {
          type: 'role_promoted',
          title: 'Congratulations!',
          message: `You have been promoted to Administrator role by the admin. You now have access to admin dashboard and privileges.`,
          data: {
            userId: id,
            oldRole: existingUser.role,
            newRole: 'admin',
            promotedAt: new Date().toISOString(),
            promotedBy: req.user._id,
          },
          createdAt: new Date().toISOString(),
        });

        console.log(`✅ Admin promotion notification sent to user: ${id}`);
      }
    } catch (notificationError) {
      console.error('❌ Failed to send role promotion notification:', notificationError);
      // Don't stop the process if notification fails
    }
  }

  // Remove password from response
  const userResponse = updatedUser.toObject();
  delete userResponse.password;

  return successResponce({
    res,
    message: 'User updated successfully',
    data: userResponse,
  });
});

// Update Profile (for current user) - UPDATED
export const updateProfile = asyncHandler(async (req, res, next) => {
  const { firstName, secondName, email, address, profilePic } = req.body;

  // Check if email is being changed and if it's already taken
  if (email && email !== req.user.email) {
    const emailExists = await findOne({
      model: userModel,
      filter: { email, _id: { $ne: req.user._id } },
    });

    if (emailExists) {
      return next(new Error('Email already taken', { cause: 409 }));
    }
  }

  // Update user using findByIdAndUpdate for better performance
  const updatedUser = await update({
    model: userModel,
    filter: { _id: req.user._id },
    data: {
      ...(firstName && { firstName }),
      ...(secondName && { secondName }),
      ...(email && { email }),
      ...(address && { address }),
      ...(profilePic && { profilePic }),
    },
    options: { new: true },
  });

  // Remove password from response
  const userResponse = updatedUser.toObject();
  delete userResponse.password;

  return successResponce({
    res,
    message: 'Profile updated successfully',
    data: userResponse,
  });
});

// Change Password - UPDATED
export const changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return next(new Error('Current password and new password are required', { cause: 400 }));
  }

  // Get user with password
  const user = await findById({
    model: userModel,
    id: req.user._id,
  });

  // Verify current password
  const isMatch = await compareHash({
    plainText: currentPassword,
    hashText: user.password,
  });

  if (!isMatch) {
    return next(new Error('Current password is incorrect', { cause: 401 }));
  }

  // Hash new password
  const hashedNewPassword = await genrateHash({
    plainText: newPassword,
    saltRound: parseInt(process.env.HASH_SALT_ROUND),
  });

  // Update password using findByIdAndUpdate
  await update({
    model: userModel,
    filter: { _id: req.user._id },
    data: { password: hashedNewPassword },
  });

  return successResponce({
    res,
    message: 'Password changed successfully',
  });
});

// Delete User - UPDATED with email and notifications
export const deleteUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const adminName = `${req.user.firstName} ${req.user.secondName}`;

  // Check if user exists
  const user = await userModel.findById(id);

  if (!user) {
    return next(new Error('User not found', { cause: 404 }));
  }

  // Prevent users from deleting themselves (optional)
  if (req.user._id.toString() === id) {
    return next(new Error('You cannot delete your own account', { cause: 400 }));
  }

  const currentDate = new Date();
  let cancelledOperations = 0;
  let terminatedBorrows = 0;
  let deletedBooks = 0;

  // ✅ الحصول على جميع العمليات النشطة المرتبطة بالمستخدم (قبل الحذف)
  const userActiveOperations = await operationModel
    .find({
      $or: [{ user_src: id }, { user_dest: id }],
      isDeleted: false,
      status: {
        $in: [
          operationStatusEnum.PENDING,
          operationStatusEnum.ACCEPTED,
          operationStatusEnum.COMPLETED,
        ],
      },
    })
    .populate('user_src', 'firstName secondName email')
    .populate('user_dest', 'firstName secondName email')
    .populate('book_dest_id', 'Title');

  // ─────────────────────────────────
  // 1️⃣ Delete User's Books and Their Operations
  // ─────────────────────────────────
  const userBooks = await bookmodel.find({
    UserID: id,
    isDeleted: false,
  });

  if (userBooks.length > 0) {
    // تحديث حالة الكتب إلى محذوفة
    await bookmodel.updateMany({ UserID: id, isDeleted: false }, { $set: { isDeleted: true } });
    deletedBooks = userBooks.length;

    // Cancel operations for all user's books
    const bookIds = userBooks.map((book) => book._id);

    // Cancel active operations for user's books
    const activeBookOperations = await operationModel.find({
      book_dest_id: { $in: bookIds },
      status: {
        $in: [operationStatusEnum.PENDING, operationStatusEnum.ACCEPTED],
      },
      isDeleted: false,
    });

    if (activeBookOperations.length > 0) {
      await operationModel.updateMany(
        {
          book_dest_id: { $in: bookIds },
          status: {
            $in: [operationStatusEnum.PENDING, operationStatusEnum.ACCEPTED],
          },
          isDeleted: false,
        },
        {
          $set: {
            status: operationStatusEnum.REJECTED,
            isDeleted: true,
          },
        }
      );
      cancelledOperations += activeBookOperations.length;
    }

    // Terminate active borrows for user's books
    const activeBookBorrows = await operationModel.find({
      book_dest_id: { $in: bookIds },
      operationType: operationTypeEnum.BORROW,
      status: operationStatusEnum.COMPLETED,
      isDeleted: false,
      startDate: { $lte: currentDate },
      endDate: { $gte: currentDate },
    });

    if (activeBookBorrows.length > 0) {
      await operationModel.updateMany(
        {
          book_dest_id: { $in: bookIds },
          operationType: operationTypeEnum.BORROW,
          status: operationStatusEnum.COMPLETED,
          isDeleted: false,
          startDate: { $lte: currentDate },
          endDate: { $gte: currentDate },
        },
        {
          $set: {
            endDate: currentDate,
            isDeleted: true,
          },
        }
      );
      terminatedBorrows += activeBookBorrows.length;
    }
  }

  // ─────────────────────────────────
  // 2️⃣ Cancel Active Operations Where User is Source
  // ─────────────────────────────────
  const activeSrcOperations = await operationModel.find({
    user_src: id,
    status: {
      $in: [operationStatusEnum.PENDING, operationStatusEnum.ACCEPTED],
    },
    isDeleted: false,
  });

  if (activeSrcOperations.length > 0) {
    await operationModel.updateMany(
      {
        user_src: id,
        status: {
          $in: [operationStatusEnum.PENDING, operationStatusEnum.ACCEPTED],
        },
        isDeleted: false,
      },
      {
        $set: {
          status: operationStatusEnum.REJECTED,
          isDeleted: true,
        },
      }
    );
    cancelledOperations += activeSrcOperations.length;
  }

  // ─────────────────────────────────
  // 3️⃣ Cancel Active Operations Where User is Destination
  // ─────────────────────────────────
  const activeDestOperations = await operationModel.find({
    user_dest: id,
    status: {
      $in: [operationStatusEnum.PENDING, operationStatusEnum.ACCEPTED],
    },
    isDeleted: false,
  });

  if (activeDestOperations.length > 0) {
    await operationModel.updateMany(
      {
        user_dest: id,
        status: {
          $in: [operationStatusEnum.PENDING, operationStatusEnum.ACCEPTED],
        },
        isDeleted: false,
      },
      {
        $set: {
          status: operationStatusEnum.REJECTED,
          isDeleted: true,
        },
      }
    );
    cancelledOperations += activeDestOperations.length;
  }

  // ─────────────────────────────────
  // 4️⃣ Terminate Active Borrows Where User is Source (Borrower)
  // ─────────────────────────────────
  const activeSrcBorrows = await operationModel.find({
    user_src: id,
    operationType: operationTypeEnum.BORROW,
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
    startDate: { $lte: currentDate },
    endDate: { $gte: currentDate },
  });

  if (activeSrcBorrows.length > 0) {
    await operationModel.updateMany(
      {
        user_src: id,
        operationType: operationTypeEnum.BORROW,
        status: operationStatusEnum.COMPLETED,
        isDeleted: false,
        startDate: { $lte: currentDate },
        endDate: { $gte: currentDate },
      },
      {
        $set: {
          endDate: currentDate,
          isDeleted: true,
        },
      }
    );
    terminatedBorrows += activeSrcBorrows.length;
  }

  // ─────────────────────────────────
  // 5️⃣ Terminate Active Borrows Where User is Destination (Book Owner)
  // ─────────────────────────────────
  const activeDestBorrows = await operationModel.find({
    user_dest: id,
    operationType: operationTypeEnum.BORROW,
    status: operationStatusEnum.COMPLETED,
    isDeleted: false,
    startDate: { $lte: currentDate },
    endDate: { $gte: currentDate },
  });

  if (activeDestBorrows.length > 0) {
    await operationModel.updateMany(
      {
        user_dest: id,
        operationType: operationTypeEnum.BORROW,
        status: operationStatusEnum.COMPLETED,
        isDeleted: false,
        startDate: { $lte: currentDate },
        endDate: { $gte: currentDate },
      },
      {
        $set: {
          endDate: currentDate,
          isDeleted: true,
        },
      }
    );
    terminatedBorrows += activeDestBorrows.length;
  }

  // ─────────────────────────────────
  // 6️⃣ إرسال إيميل للمستخدم المحذوف فقط (بدون اسم الأدمن)
  // ─────────────────────────────────
  let emailSent = false;
  try {
    sendEmailEvent.emit('userDeletedByAdmin', {
      userEmail: user.email,
      userName: `${user.firstName} ${user.secondName}`,
      reason: 'violation of platform policies',
    });

    emailSent = true;
    console.log(`📧 Admin deletion email sent to ${user.email} (without admin name)`);
  } catch (emailError) {
    console.error('Failed to send deletion email:', emailError);
  }
  // ─────────────────────────────────
  // 7️⃣ إرسال إشعارات فقط (بدون إيميلات) للمستخدمين المتأثرين
  // ─────────────────────────────────
  let notificationsSent = false;
  try {
    await sendUserDeletionNotifications(user, userActiveOperations);
    notificationsSent = true;
  } catch (notificationError) {
    console.error('Failed to send notifications:', notificationError);
  }

  // ─────────────────────────────────
  // 8️⃣ Delete User
  // ─────────────────────────────────
  await userModel.findByIdAndDelete(id);

  const totalCancelled = cancelledOperations + terminatedBorrows;

  return successResponce({
    res,
    message: `User deleted successfully${
      totalCancelled > 0 ? ` (${totalCancelled} operations were cancelled)` : ''
    }${deletedBooks > 0 ? ` and ${deletedBooks} books were deleted` : ''}`,
    data: {
      deletedBooks: deletedBooks,
      cancelledOperations: cancelledOperations,
      terminatedBorrows: terminatedBorrows,
      totalCancelled: totalCancelled,
      emailSent: emailSent,
      notificationsSent: notificationsSent,
      userDetails: {
        id: user._id,
        name: `${user.firstName} ${user.secondName}`,
        email: user.email,
        deletedAt: new Date().toISOString(),
        deletedBy: {
          adminId: req.user._id,
          adminName: adminName,
        },
      },
    },
  });
});

/**
 * دالة مساعدة لإرسال إشعارات فقط (بدون إيميلات) للمستخدمين المتأثرين
 */
const sendUserDeletionNotifications = async (deletedUser, activeOperations) => {
  try {
    const notificationService = getNotificationService();

    if (!notificationService) {
      console.error('❌ Notification service not available');
      return;
    }

    const deletedUserId = deletedUser._id.toString();
    const deletedUserName = `${deletedUser.firstName} ${deletedUser.secondName}`;
    const deletedUserEmail = deletedUser.email;

    const affectedUsers = new Set();

    // جمع جميع المستخدمين المتأثرين (باستثناء المستخدم المحذوف)
    activeOperations.forEach((operation) => {
      // إضافة user_src إذا لم يكن هو المستخدم المحذوف
      if (operation.user_src && operation.user_src._id.toString() !== deletedUserId) {
        affectedUsers.add({
          userId: operation.user_src._id.toString(),
          userName: `${operation.user_src.firstName} ${operation.user_src.secondName}`,
          userEmail: operation.user_src.email,
          operationType: operation.operationType,
          operationId: operation._id.toString(),
          bookTitle: operation.book_dest_id?.Title || 'Unknown Book',
          role: 'counterparty',
        });
      }

      // إضافة user_dest إذا لم يكن هو المستخدم المحذوف
      if (operation.user_dest && operation.user_dest._id.toString() !== deletedUserId) {
        affectedUsers.add({
          userId: operation.user_dest._id.toString(),
          userName: `${operation.user_dest.firstName} ${operation.user_dest.secondName}`,
          userEmail: operation.user_dest.email,
          operationType: operation.operationType,
          operationId: operation._id.toString(),
          bookTitle: operation.book_dest_id?.Title || 'Unknown Book',
          role: 'counterparty',
        });
      }
    });

    // إرسال إشعار WebSocket فقط لكل مستخدم متأثر (بدون إيميلات)
    for (const user of Array.from(affectedUsers)) {
      try {
        const message =
          user.bookTitle !== 'Unknown Book'
            ? `Your ${user.operationType} operation for the book "${user.bookTitle}" with user "${deletedUserName}" has been cancelled because the user was deleted by an admin.`
            : `Your operation with user "${deletedUserName}" has been cancelled because the user was deleted by an admin.`;

        // إرسال إشعار عبر WebSocket فقط
        await notificationService.emitToUser(user.userId, 'operation-cancelled', {
          type: 'operation_cancellation',
          operationId: user.operationId,
          operationType: user.operationType,
          reason: 'user_deleted_by_admin',
          message,
          cancelledAt: new Date().toISOString(),
          note: 'This action was taken by an administrator.',
          affectedParties: {
            deletedUser: {
              id: deletedUserId,
              name: deletedUserName,
              email: deletedUserEmail,
            },
            yourRole: user.role,
          },
        });

        console.log(`✅ Admin deletion notification sent to: ${user.userName} (WebSocket only)`);
      } catch (error) {
        console.error(`❌ Failed to send notification to user ${user.userId}:`, error);
      }
    }

    console.log(`✅ Total ${affectedUsers.size} users notified via WebSocket only`);
    return true;
  } catch (error) {
    console.error('❌ Error sending admin deletion notifications:', error);
    return false;
  }
};

// Confirm User (for admin) - UPDATED with email notification
export const confirmUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const user = await findById({
    model: userModel,
    id: id,
  });

  if (!user) {
    return next(new Error('User not found', { cause: 404 }));
  }

  if (user.isConfirmed) {
    return next(new Error('User is already confirmed', { cause: 400 }));
  }

  const updatedUser = await update({
    model: userModel,
    filter: { _id: id },
    data: { isConfirmed: true },
    options: { new: true },
  });

  // ─────────────────────────────────
  // إرسال إيميل تأكيد للمستخدم
  // ─────────────────────────────────
  let emailSent = false;
  try {
    sendEmailEvent.emit('userConfirmedByAdmin', {
      userEmail: user.email,
      userName: `${user.firstName} ${user.secondName}`,
    });

    emailSent = true;
    console.log(`📧 Confirmation email sent to ${user.email}`);
  } catch (emailError) {
    console.error('Failed to send confirmation email:', emailError);
  }

  // Remove password from response
  const userResponse = updatedUser.toObject();
  delete userResponse.password;

  // إضافة حالة الإيميل للاستجابة
  userResponse.emailSent = emailSent;

  return successResponce({
    res,
    message: 'User confirmed successfully',
    data: userResponse,
  });
});

export const sendFriendRequest = asyncHandler(async (req, res, next) => {
  const { friendId } = req.body;
  const userId = req.user._id;

  // Prevent sending friend request to yourself
  if (userId.toString() === friendId) {
    return next(new AppError('You cannot send a friend request to yourself', 400));
  }

  // Check if friend exists
  const friend = await findById({
    model: userModel,
    id: friendId,
  });

  if (!friend) {
    return next(new AppError('User not found', 404));
  }

  // Get current user
  const currentUser = await findById({
    model: userModel,
    id: userId,
  });

  // Check if already friends
  if (currentUser.friends.includes(friendId)) {
    return next(new AppError('You are already friends with this user', 400));
  }

  // Check if friend request already exists (pending)
  const existingRequest = currentUser.sentFriendRequests.find(
    (req) => req.userId.toString() === friendId && req.status === friendRequestStatusEnum.pending
  );

  if (existingRequest) {
    return next(new AppError('Friend request already sent', 400));
  }

  // Check if there's a pending request from the friend
  const incomingRequest = currentUser.receivedFriendRequests.find(
    (req) => req.userId.toString() === friendId && req.status === friendRequestStatusEnum.pending
  );

  if (incomingRequest) {
    return next(
      new AppError(
        'This user has already sent you a friend request. Please accept or reject it.',
        400
      )
    );
  }

  // Add to sent requests for current user
  currentUser.sentFriendRequests.push({
    userId: friendId,
    status: friendRequestStatusEnum.pending,
    requestedAt: new Date(),
  });

  // Add to received requests for friend
  friend.receivedFriendRequests.push({
    userId: userId,
    status: friendRequestStatusEnum.pending,
    requestedAt: new Date(),
  });

  await currentUser.save();
  await friend.save();

  return successResponce({
    res,
    status: 201,
    message: 'Friend request sent successfully',
    data: {
      requestedTo: {
        _id: friend._id,
        firstName: friend.firstName,
        secondName: friend.secondName,
        email: friend.email,
        profilePic: friend.profilePic,
      },
    },
  });
});

// List Friend Requests (with status filter)
export const listFriendRequests = asyncHandler(async (req, res, next) => {
  const { status } = req.query;
  const userId = req.user._id;

  // Get current user with populated friend requests
  const user = await userModel
    .findById(userId)
    .populate({
      path: 'receivedFriendRequests.userId',
      select: 'firstName secondName email profilePic',
    })
    .select('-password');

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Filter received friend requests based on status
  let friendRequests = user.receivedFriendRequests;

  if (status) {
    friendRequests = friendRequests.filter((req) => req.status === status);
  }

  // Format the response
  const formattedRequests = friendRequests.map((req) => ({
    requestId: req._id,
    user: req.userId,
    status: req.status,
    requestedAt: req.requestedAt,
    respondedAt: req.respondedAt,
  }));

  return successResponce({
    res,
    message: 'Friend requests retrieved successfully',
    data: {
      friendRequests: formattedRequests,
      total: formattedRequests.length,
    },
  });
});

// Accept Friend Request
export const acceptFriendRequest = asyncHandler(async (req, res, next) => {
  const { requestId } = req.params;
  console.log({ requestId });
  const userId = req.user._id;

  // Get current user
  const user = await findById({
    model: userModel,
    id: userId,
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Find the friend request

  console.log(user.receivedFriendRequests);
  const friendRequest = user.receivedFriendRequests[0];

  if (!friendRequest) {
    return next(new AppError('Friend request not found', 404));
  }

  if (friendRequest.status !== friendRequestStatusEnum.pending) {
    return next(new AppError('Friend request has already been responded to', 400));
  }

  const friendId = friendRequest.userId;

  // Get the friend
  const friend = await findById({
    model: userModel,
    id: friendId,
  });

  if (!friend) {
    return next(new AppError('User not found', 404));
  }

  // Update the request status in received requests
  friendRequest.status = friendRequestStatusEnum.accepted;
  friendRequest.respondedAt = new Date();

  // Update the request status in friend's sent requests
  const sentRequest = friend.sentFriendRequests.find(
    (req) => req.userId.toString() === userId.toString()
  );

  if (sentRequest) {
    sentRequest.status = friendRequestStatusEnum.accepted;
    sentRequest.respondedAt = new Date();
  }

  // Add to friends list for both users
  if (!user.friends.includes(friendId)) {
    user.friends.push(friendId);
  }
  if (!friend.friends.includes(userId)) {
    friend.friends.push(userId);
  }

  await user.save();
  await friend.save();

  return successResponce({
    res,
    message: 'Friend request accepted successfully',
    data: {
      friend: {
        _id: friend._id,
        firstName: friend.firstName,
        secondName: friend.secondName,
        email: friend.email,
        profilePic: friend.profilePic,
      },
    },
  });
});

// Reject Friend Request
export const rejectFriendRequest = asyncHandler(async (req, res, next) => {
  const { requestId } = req.params;
  const userId = req.user._id;

  // Get current user
  const user = await findById({
    model: userModel,
    id: userId,
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Find the friend request
  const friendRequest = user.receivedFriendRequests.id(requestId);

  if (!friendRequest) {
    return next(new AppError('Friend request not found', 404));
  }

  if (friendRequest.status !== friendRequestStatusEnum.pending) {
    return next(new AppError('Friend request has already been responded to', 400));
  }

  const friendId = friendRequest.userId;

  // Get the friend
  const friend = await findById({
    model: userModel,
    id: friendId,
  });

  if (!friend) {
    return next(new AppError('User not found', 404));
  }

  // Update the request status in received requests
  friendRequest.status = friendRequestStatusEnum.rejected;
  friendRequest.respondedAt = new Date();

  // Update the request status in friend's sent requests
  const sentRequest = friend.sentFriendRequests.find(
    (req) => req.userId.toString() === userId.toString()
  );

  if (sentRequest) {
    sentRequest.status = friendRequestStatusEnum.rejected;
    sentRequest.respondedAt = new Date();
  }

  await user.save();
  await friend.save();

  return successResponce({
    res,
    message: 'Friend request rejected successfully',
  });
});

// Get Friends List
export const getFriendsList = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  const user = await userModel
    .findById(userId)
    .populate({
      path: 'friends',
      select: 'firstName secondName email profilePic',
    })
    .select('-password');

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  return successResponce({
    res,
    message: 'Friends list retrieved successfully',
    data: {
      friends: user.friends,
      total: user.friends.length,
    },
  });
});

// Remove Friend
export const removeFriend = asyncHandler(async (req, res, next) => {
  const { friendId } = req.params;
  const userId = req.user._id;

  // Get both users
  const user = await findById({
    model: userModel,
    id: userId,
  });

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const friend = await findById({
    model: userModel,
    id: friendId,
  });

  if (!friend) {
    return next(new AppError('User not found', 404));
  }

  // Check if they are actually friends
  if (!user.friends.includes(friendId)) {
    return next(new AppError('You are not friends with this user', 400));
  }

  // Remove from friends list
  user.friends = user.friends.filter((id) => id.toString() !== friendId);
  friend.friends = friend.friends.filter((id) => id.toString() !== userId.toString());

  await user.save();
  await friend.save();

  return successResponce({
    res,
    message: 'Friend removed successfully',
  });
});

export const getUserPublicProfile = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const user = await findOne({
    model: userModel,
    filter: { _id: id },
    select: 'firstName secondName email profilePic address friends createdAt',
  });

  if (!user) {
    return next(new Error('User not found', { cause: 404 }));
  }

  // Get friend count
  const friendCount = user.friends.length;

  // Prepare public profile data (exclude sensitive information)
  const publicProfile = {
    _id: user._id,
    firstName: user.firstName,
    secondName: user.secondName,
    email: user.email,
    profilePic: user.profilePic,
    address: user.address,
    friendCount: friendCount,
    memberSince: user.createdAt,
  };

  return successResponce({
    res,
    message: 'User public profile retrieved successfully',
    data: publicProfile,
  });
});
