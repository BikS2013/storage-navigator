import { ApiError } from '../errors/api-error.js';

export type PageInputs = {
  pageSize?: string;
  continuationToken?: string;
};

export type PageParams = {
  pageSize: number;
  continuationToken?: string;
};

export function parsePage(inputs: PageInputs, defaults: { defaultPageSize: number; maxPageSize: number }): PageParams {
  let pageSize = defaults.defaultPageSize;
  if (inputs.pageSize !== undefined) {
    const n = Number(inputs.pageSize);
    if (!Number.isInteger(n) || n <= 0) throw ApiError.badRequest('pageSize must be a positive integer');
    if (n > defaults.maxPageSize) throw ApiError.badRequest(`pageSize exceeds max ${defaults.maxPageSize}`);
    pageSize = n;
  }
  return { pageSize, continuationToken: inputs.continuationToken };
}
