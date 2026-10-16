import { BadRequestException } from '@nestjs/common';

export type Page<T> = {
  items: T[];
  total: number;
  page: number; // 1-based
  pageSize: number;
};

export type PageRequest = { page: number; pageSize: number };

export function toOffset({ page, pageSize }: PageRequest) {
  return { offset: (page - 1) * pageSize, limit: pageSize };
}

/** Reads `?page=&pageSize=` from a query string. page is 1-based. */
export function parsePageQuery(
  query: Record<string, unknown>,
  { defaultPageSize = 20, maxPageSize = 100 } = {},
): PageRequest {
  return {
    page: positiveInt(query.page, 'page', 1, Number.MAX_SAFE_INTEGER),
    pageSize: positiveInt(
      query.pageSize,
      'pageSize',
      defaultPageSize,
      maxPageSize,
    ),
  };
}

function positiveInt(
  value: unknown,
  key: string,
  fallback: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  const n = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new BadRequestException(
      max === Number.MAX_SAFE_INTEGER
        ? `${key} must be a positive integer`
        : `${key} must be an integer from 1 to ${max}`,
    );
  }
  return n;
}
