import Joi from 'joi';

export const dataSchema = Joi.object({
  topic: Joi.string().required(),
  payload: Joi.object({
    event: Joi.string().valid('top', 'base').optional(),
    t_ms: Joi.number().min(0).optional(),
  }).required(),
});
