/**
 * Common shared types across frontend domain models.
 */

/**
 * Common ID types representing unique entity identifiers.
 */
export type EntityId = string | number;

/**
 * Standard binary status string matching backend canonical contract.
 */
export type StatusString = 'enabled' | 'disabled';

/**
 * Nullable or optional utility type.
 */
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;

/**
 * Generic key-value dictionary with unknown values.
 */
export type Dictionary<T = unknown> = Record<string, T>;

/**
 * Key-value mapping representing string query parameters.
 */
export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/**
 * Standard sort order options.
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Common sorting options for lists and tables.
 */
export interface SortOptions {
  field?: string;
  order?: SortDirection;
}

/**
 * Generic option representation for selects, radios, and filters.
 */
export interface SelectOption<T = string> {
  label: string;
  value: T;
  disabled?: boolean;
  code?: string;
  count?: number;
}
