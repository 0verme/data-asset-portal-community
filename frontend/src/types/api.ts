/**
 * API request, response, and error envelope types.
 */

import type { Dictionary } from './common.ts';

/**
 * Standard HTTP methods supported by client.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * Standard request options extending RequestInit.
 */
export interface RequestOptions extends Omit<RequestInit, 'method' | 'body'> {
  method?: HttpMethod;
  headers?: Record<string, string>;
  params?: Dictionary<string | number | boolean | undefined | null>;
  body?: unknown;
  timeout?: number;
  skipAuthRefresh?: boolean;
}

/**
 * Standard backend error model.
 */
export interface ApiErrorModel {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Backend error envelope.
 */
export interface ApiErrorEnvelope {
  error: ApiErrorModel;
}

/**
 * Envelope with `data` payload.
 */
export interface DataEnvelope<T> {
  data: T;
}

/**
 * Envelope with `message` and `data` payload.
 */
export interface MessageDataResponse<T = unknown> {
  message: string;
  data: T;
}

/**
 * Standard action response with message or success indicator.
 */
export interface ActionResponse {
  message?: string;
  success?: boolean;
  status?: string;
  [key: string]: unknown;
}
