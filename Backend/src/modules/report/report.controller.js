import Report from '../../DB/models/report.model.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError } from '../../utils/AppError.js';
import { successResponce } from '../../utils/Response.js';
import { findManyNonDeleted, restoreSoftDelete, softDelete } from '../../DB/db.services.js';
import { operationStatusEnum, operationTypeEnum } from '../../enum.js';
import Book from '../../DB/models/bookmodel.js';
import operationModel from '../../DB/models/operation.model.js';

/**
 * دالة مساعدة لحذف الكتاب عند 3 إبلاغات
 */
const deleteBookDueToReports = async (bookId) => {
  try {
    const book = await Book.findOne({ _id: bookId, isDeleted: false });

    if (!book) {
      return { success: false, message: 'Book already deleted or not found' };
    }

    const soldOrDonated = await operationModel.findOne({
      book_dest_id: bookId,
      operationType: { $in: [operationTypeEnum.BUY, operationTypeEnum.DONATE] },
      status: operationStatusEnum.COMPLETED,
      isDeleted: false,
    });

    if (soldOrDonated) {
      return { success: false, message: 'Book has been sold or donated' };
    }

    const currentDate = new Date();

    await operationModel.updateMany(
      {
        book_dest_id: bookId,
        status: { $in: [operationStatusEnum.PENDING, operationStatusEnum.ACCEPTED] },
        isDeleted: false,
      },
      {
        $set: {
          status: operationStatusEnum.REJECTED,
          isDeleted: true,
        },
      }
    );

    await operationModel.updateMany(
      {
        book_dest_id: bookId,
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

    book.isDeleted = true;
    await book.save();

    console.log(`🚨 Book ${bookId} deleted due to 3 reviewed reports`);

    return {
      success: true,
      message: 'Book automatically deleted due to 3 reviewed reports',
      bookTitle: book.Title,
      deletionDate: currentDate,
    };
  } catch (error) {
    console.error('Error deleting book due to reports:', error);
    return { success: false, message: error.message };
  }
};

/**
 * دالة مساعدة لتعبئة بيانات التقارير
 */
const populateReports = async (reports) => {
  for (let report of reports) {
    await report.populate({
      path: 'reporterId',
      select: 'firstName secondName fullName',
      model: 'user',
    });

    if (report.targetType === 'user') {
      await report.populate({
        path: 'targetId',
        select: 'firstName secondName fullName',
        model: 'user',
      });
    } else if (report.targetType === 'Book') {
      await report.populate({
        path: 'targetId',
        select: 'Title',
        model: 'Book',
      });
    }
  }
};

/**
 * @desc Create a new report (Book or User)
 * @route POST /reports
 * @access User
 */
export const createReport = asyncHandler(async (req, res, next) => {
  const { targetType, targetId, reason, description } = req.body;
  const reporterId = req.user._id;

  if (targetType === 'user' && targetId === reporterId.toString()) {
    return next(new AppError('You cannot report yourself.', 403));
  }

  const duplicateReport = await Report.findOne({
    reporterId,
    targetType,
    targetId,
    reason,
    description: description || '',
    status: { $ne: 'Cancelled' },
  });

  if (duplicateReport) {
    return next(new AppError('You have already submitted this exact report.', 400));
  }

  const report = await Report.create({
    reporterId,
    targetType,
    targetId,
    reason,
    description: description || '',
  });

  return successResponce({
    res,
    status: 201,
    message: 'Report created successfully.',
    data: report,
  });
});

/**
 * @desc Get all my reports
 * @route GET /reports/my
 * @access User
 */
export const getMyReports = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  const reports = await findManyNonDeleted({
    model: Report,
    filter: { reporterId: userId },
    sort: { createdAt: -1 },
  });

  if (!reports.length) {
    return next(new AppError('No reports found.', 404));
  }

  for (let report of reports) {
    if (report.targetType === 'user') {
      await report.populate({ path: 'targetId', select: 'firstName secondName', model: 'user' });
    } else if (report.targetType === 'Book') {
      await report.populate({ path: 'targetId', select: 'Title', model: 'Book' });
    }
  }

  return successResponce({
    res,
    message: 'Your reports fetched successfully.',
    data: reports,
  });
});

/**
 * @desc Get all reports (Admin only)
 * @route GET /reports
 * @access Admin
 */
export const getAllReports = asyncHandler(async (req, res, next) => {
  const reports = await findManyNonDeleted({
    model: Report,
    filter: { status: { $ne: 'Cancelled' } },
    sort: { createdAt: -1 },
  });

  if (!reports.length) return next(new AppError('No reports found.', 404));

  await populateReports(reports);

  return successResponce({
    res,
    message: 'Reports fetched successfully.',
    data: reports,
  });
});

/**
 * @desc Get reports created by a specific user
 * @route GET /reports/user/:userId
 * @access Admin
 */
export const getReportsByUser = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  const reports = await findManyNonDeleted({
    model: Report,
    filter: {
      reporterId: userId,
      status: { $ne: 'Cancelled' },
    },
    sort: { createdAt: -1 },
  });

  if (!reports.length) {
    return next(new AppError('No reports found for this user.', 404));
  }

  await populateReports(reports);

  return successResponce({
    res,
    message: 'Reports fetched successfully.',
    data: reports,
  });
});

/**
 * @desc Get reports made against a specific user
 * @route GET /reports/target/:userId
 * @access Admin
 */
export const getReportsAgainstUser = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  const reports = await Report.find({ targetType: 'user', targetId: userId })
    .populate('reporterId')
    .populate('targetId')
    .sort({ createdAt: -1 });

  if (!reports.length) {
    return next(new AppError('No reports found against this user.', 404));
  }

  return successResponce({
    res,
    message: 'Reports against user fetched successfully.',
    data: reports,
  });
});

/**
 * @desc Update report status (Admin only)
 * @route PATCH /reports/:id
 * @access Admin
 */
export const updateReportStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;
  const { id } = req.params;

  const allowedStatuses = ['Pending', 'Reviewed', 'Dismissed'];
  if (!allowedStatuses.includes(status)) {
    return next(new AppError('Invalid status value.', 400));
  }

  const report = await Report.findByIdAndUpdate(id, { status }, { new: true })
    .populate('reporterId')
    .populate('targetId');

  if (!report) return next(new AppError('Report not found.', 404));

  let autoDeletionResult = null;

  if (report.targetType === 'Book' && status === 'Reviewed') {
    try {
      const reviewedReportsCount = await Report.countDocuments({
        targetType: 'Book',
        targetId: report.targetId,
        status: 'Reviewed',
        isDeleted: false,
      });

      console.log(`📊 Book ${report.targetId} now has ${reviewedReportsCount} reviewed reports`);

      if (reviewedReportsCount >= 3) {
        console.log(`🚨 Book ${report.targetId} reached 3 reviewed reports! Auto-deleting...`);
        autoDeletionResult = await deleteBookDueToReports(report.targetId);
      }
    } catch (error) {
      console.error('Failed to check auto-deletion:', error);
    }
  }

  const responseData = report.toObject();

  if (autoDeletionResult) {
    responseData.autoDeletion = autoDeletionResult;
  }

  return successResponce({
    res,
    message: autoDeletionResult
      ? `Report status updated to ${status}. ${autoDeletionResult.message}`
      : `Report status updated to ${status}`,
    data: responseData,
  });
});

/**
 * @desc Cancel report by user (if still pending)
 * @route PATCH /reports/:id/cancel
 * @access User (report owner only)
 */
export const cancelReport = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const report = await Report.findById(id).populate('reporterId').populate('targetId');

  if (!report) return next(new AppError('Report not found.', 404));

  if (report.reporterId._id.toString() !== req.user._id.toString()) {
    return next(new AppError('You can only cancel your own reports.', 403));
  }

  if (report.status !== 'Pending') {
    return next(new AppError('Only pending reports can be cancelled.', 400));
  }

  report.status = 'Cancelled';
  await report.save();

  return successResponce({
    res,
    message: 'Report cancelled successfully.',
    data: report,
  });
});

/**
 * @desc Soft delete a report (Admin only)
 * @route DELETE /reports/:id
 * @access Admin
 */
export const deleteReport = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const deletedReport = await softDelete({
    model: Report,
    filter: { _id: id },
  });

  if (!deletedReport) {
    return next(new AppError('Report not found or already deleted.', 404));
  }

  return successResponce({
    res,
    message: 'Report soft deleted successfully.',
    data: deletedReport,
  });
});

/**
 * @desc Restore a soft deleted report (Admin only)
 * @route PATCH /reports/restore/:id
 * @access Admin
 */
export const restoreReport = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const restoredReport = await restoreSoftDelete({
    model: Report,
    filter: { _id: id },
  });

  if (!restoredReport) {
    return next(new AppError('Report not found or already active.', 404));
  }

  return successResponce({
    res,
    message: 'Report restored successfully.',
    data: restoredReport,
  });
});
