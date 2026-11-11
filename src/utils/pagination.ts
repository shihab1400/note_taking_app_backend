import { z } from 'zod';

export const MAX_LIMIT = 100;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
});

export type Pagination = z.infer<typeof paginationSchema> & { skip: number };

export function toPagination(input: { page: number; limit: number }): Pagination {
  return { ...input, skip: (input.page - 1) * input.limit };
}

export function paged<T>(data: T[], p: Pagination, total: number) {
  return {
    data,
    page: p.page,
    limit: p.limit,
    total,
    totalPages: Math.ceil(total / p.limit),
  };
}
