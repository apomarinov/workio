import { ZodDefault, type ZodObject, type ZodRawShape, z } from 'zod'

/** Strip .default() wrappers so .partial() doesn't fill in defaults for missing fields */
export function stripDefaults<T extends ZodRawShape>(schema: ZodObject<T>) {
  const shape: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema.shape)) {
    shape[key] =
      field instanceof ZodDefault
        ? (field.removeDefault() as typeof field)
        : field
  }
  return z.object(shape as T)
}
