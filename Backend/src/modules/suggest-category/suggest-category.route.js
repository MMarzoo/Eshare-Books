import express from 'express';
import { auth, adminCheckmiddelware } from '../../middelwares/auth.middleware.js';
import {
  createSuggestedCategory,
  deleteSuggestedCategory,
  getAllSuggestedCategories,
  getSuggestedCategoryById,
  acceptSuggestedCategory,
  rejectSuggestedCategory,
} from './suggest-category.controller.js';
import {
  validateAcceptCategory,
  validateRejectCategory,
  validateSuggestCategory,
} from '../../middelwares/validation.middleware.js';

const suggestCategoryRouter = express.Router();

// Create suggestion - Any authenticated user
suggestCategoryRouter.post('/', auth, validateSuggestCategory, createSuggestedCategory);

// Get all suggested categories - Admin only
suggestCategoryRouter.get('/', auth, adminCheckmiddelware, getAllSuggestedCategories);

// Get suggested category by id - Admin only
suggestCategoryRouter.get('/:id', auth, adminCheckmiddelware, getSuggestedCategoryById);

// Delete suggested category - Admin only
suggestCategoryRouter.delete('/:id', auth, adminCheckmiddelware, deleteSuggestedCategory);

// Accept suggested category - Admin only
suggestCategoryRouter.patch(
  '/:id/accept',
  auth,
  adminCheckmiddelware,
  validateAcceptCategory,
  acceptSuggestedCategory
);

// Reject suggested category - Admin only
suggestCategoryRouter.patch(
  '/:id/reject',
  auth,
  adminCheckmiddelware,
  validateRejectCategory,
  rejectSuggestedCategory
);

export default suggestCategoryRouter;
