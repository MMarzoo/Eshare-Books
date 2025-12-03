import Joi from 'joi';

// Suggest Category Validation Schema (للإنشاء)
const suggestCategorySchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[^\d]*$/) // No numbers allowed
    .required()
    .messages({
      'string.empty': 'Category name is required.',
      'string.min': 'Category name must be at least 3 characters long.',
      'string.max': 'Category name must not exceed 50 characters.',
      'string.pattern.base': 'Category name cannot contain numbers.',
      'any.required': 'Category name is required.',
    }),
});

// Reject Category Validation Schema (للرفض)
const rejectCategorySchema = Joi.object({
  rejectionReason: Joi.string().trim().min(5).max(500).optional().allow('').messages({
    'string.min': 'Rejection reason must be at least 5 characters long if provided.',
    'string.max': 'Rejection reason must not exceed 500 characters.',
  }),
});

// Accept Category Validation Schema (للقبول)
const acceptCategorySchema = Joi.object({});

export { suggestCategorySchema, rejectCategorySchema, acceptCategorySchema };
