import Joi from 'joi';
import mongoose from 'mongoose';

const objectId = (value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.message('Invalid categoryId');
  }
  return value;
};

// ✅ Max limits
const MAX_SALE_PRICE = 100000;
const MAX_BORROW_PRICE_PER_DAY = 500;

export const BookValidation = Joi.object({
  Title: Joi.string().required().trim(),
  Description: Joi.string().allow('').optional(),
  categoryId: Joi.string().custom(objectId).required(),

  TransactionType: Joi.string().valid('toSale', 'toBorrow', 'toDonate').required(),

  Price: Joi.number()
    .min(1)
    .max(MAX_SALE_PRICE)
    .when('TransactionType', {
      is: 'toSale',
      then: Joi.required(),
      otherwise: Joi.optional().allow(null, 0),
    }),

  PricePerDay: Joi.number()
    .min(1)
    .max(MAX_BORROW_PRICE_PER_DAY)
    .when('TransactionType', {
      is: 'toBorrow',
      then: Joi.required(),
      otherwise: Joi.optional().allow(null, 0),
    }),
});

// ✅ Validation for Admin Update Book Category
export const updateCategoryValidation = Joi.object({
  categoryId: Joi.string().custom(objectId).required().messages({
    'any.required': 'Category ID is required',
    'string.base': 'Category ID must be a string',
  }),
});
