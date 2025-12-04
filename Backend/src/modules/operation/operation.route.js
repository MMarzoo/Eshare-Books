import express from 'express';
import {
  createOperation,
  deleteOperation,
  getAllOperation,
  getUserOperations,
  updateOperation,
  checkReportBeforeOperation,
  getMyBooksAsSource,
  getMyBooksAsDest, // ✅ NEW
} from './operation.controller.js';
import { auth } from '../../middelwares/auth.middleware.js';
import {
  validateCreateOperation,
  validateUpdateOperation,
} from '../../middelwares/validationOperation.middleware.js';
import { authorizeOperation } from '../../middelwares/authOperation.middleware.js';

const operationRouter = express.Router();
operationRouter.use(auth);

// @desc    Get all operations
// @route   GET /api/operations
// @access  Authenticated users (Admin sees all, Users see their own)
operationRouter.get('/all', getAllOperation);

// ✅ NEW: Check for report warnings before creating operation
// @route   POST /api/operations/check-report
// @access  Authenticated users
operationRouter.post('/check-report', checkReportBeforeOperation);

// @desc    Create new operation
// @route   POST /api/operations
// @access  Authenticated users
operationRouter.post('/', validateCreateOperation, createOperation);

// @desc    Update operation status
// @route   PUT /api/operations/:id
// @access  Authenticated users (only involved users or admin)
operationRouter.put('/:id', validateUpdateOperation, authorizeOperation, updateOperation);

// @desc    Delete an operation
// @route   DELETE /api/operations/:id
// @access  Authenticated users (only involved users or admin)
operationRouter.delete('/:id', authorizeOperation, deleteOperation);

// @desc    Get user operations
// @route   GET /api/operations/user
// @access  Authenticated users
operationRouter.get('/user', getUserOperations);

// ✅ NEW: Get books where user is the source
// @route   GET /api/operations/my-books-as-source
// @access  Authenticated users
operationRouter.get('/my-books-as-source', getMyBooksAsSource);

// ✅ NEW: Get books where user is the destination
// @route   GET /api/operations/my-books-as-dest
// @access  Authenticated users
operationRouter.get('/my-books-as-dest', getMyBooksAsDest);

export default operationRouter;
