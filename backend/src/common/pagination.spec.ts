import { BadRequestException } from '@nestjs/common';
import { parsePageQuery, toOffset } from './pagination.js';

describe('parsePageQuery', () => {
  it('defaults to the first page of 20', () => {
    expect(parsePageQuery({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('reads page and pageSize from strings', () => {
    expect(parsePageQuery({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it.each([
    { page: '0' },
    { page: '1.5' },
    { page: 'abc' },
    { pageSize: '101' },
    { page: ['1', '2'] },
  ])('rejects %o', (query) => {
    expect(() => parsePageQuery(query)).toThrow(BadRequestException);
  });

  it('converts to offset and limit', () => {
    expect(toOffset({ page: 3, pageSize: 20 })).toEqual({
      offset: 40,
      limit: 20,
    });
  });
});
