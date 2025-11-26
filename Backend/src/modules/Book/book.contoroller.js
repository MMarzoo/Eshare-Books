import { Router } from 'express';
import {
  addBook,
  getAllBooks,
  getBookById,
  updateBook,
  deleteBook,
  getBooksByCategory,
  getBooksByTransactionType,
  getBooksByUserId,
  getAllBooksIncludingAll,
  adminDeleteBook,
  adminUpdateModeration,
  adminRestoreBook,
  adminUpdateBookCategory,
} from './book.service.js';
import { upload, fileValidation } from '../../utils/file Uploadind/multerCloud.js';
import { auth, adminCheckmiddelware } from '../../middelwares/auth.middleware.js';
import { validateRequest } from '../../middelwares/validation.middleware.js';
import { BookValidation } from './book.validation.js';

const router = Router();

/* ──────────────────────────────
   📘 Add Book (With Validation)
────────────────────────────── */
router.post(
  '/addbook',
  auth,
  upload(fileValidation.images).single('image'),
  validateRequest(BookValidation, 'body'),
  addBook
);

//📘 Get All Books
router.get('/allbooks', getAllBooks);

// 📘 Get All Books Including Everything (For Admin - includes deleted, sold, donated)
router.get('/allbooks/admin', auth, adminCheckmiddelware, getAllBooksIncludingAll);

// 📘 Admin Delete Any Book
router.delete('/admin/books/:id', auth, adminCheckmiddelware, adminDeleteBook);

// 📘 Admin Update Book Moderation Status
router.patch('/admin/books/:id/moderate', auth, adminCheckmiddelware, adminUpdateModeration);

// 📘 Admin Restore Deleted Book
router.patch('/admin/books/:id/restore', auth, adminCheckmiddelware, adminRestoreBook);

// 📘 Admin Update Book Category
router.patch('/admin/books/:id/category', auth, adminCheckmiddelware, adminUpdateBookCategory);

/* ──────────────────────────────
   📘 Get Books by Category ID
────────────────────────────── */
router.get('/category/:categoryId', getBooksByCategory);

router.get('/:id', getBookById);

router.patch('/:id', auth, upload(fileValidation.images).single('image'), updateBook);

router.delete('/:id', auth, deleteBook);
// 📘 Get Books by Transaction Type
router.get('/type/:type', getBooksByTransactionType);

router.get('/user/:userId', getBooksByUserId);

export default router;
