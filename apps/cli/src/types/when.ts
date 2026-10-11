import type { ProjectContext } from '@/types/ctx';
import type { StackName } from '@/types/stack-name';

/** Type-level brand of a `$when` item; `lib/when.ts` creates the runtime symbol under this type. */
export declare const WHEN_TAG: unique symbol;

type Negatable<T> = T | { not: T };

export type MatchValue = string | string[] | true;

export interface WhenMatch extends Partial<Record<keyof ProjectContext, Negatable<MatchValue>>> {
  stack?: Negatable<StackName | StackName[]>;
  library?: Negatable<string | string[]>;
  repo?: Negatable<'single' | 'turborepo'>;
}

export interface WhenItem<T = unknown> {
  [WHEN_TAG]: true;
  match: WhenMatch;
  value: T;
}

export type Conditional<T> = T | WhenItem<T>;

type ResolvedRecord<T> = {
  [Key in keyof T as string extends Key ? Key : never]: Exclude<Resolved<T[Key]>, undefined>;
} & {
  [Key in keyof T as string extends Key ? never : Key]?: Resolved<T[Key]>;
};

/**
 * What `resolveConditionals` returns: unmatched items are dropped (so a `$when` value may be
 * `undefined`), as are keys that resolve to nothing or to an empty array/object.
 */
export type Resolved<T> =
  T extends WhenItem<infer Value>
    ? Resolved<Value> | undefined
    : T extends readonly (infer Item)[]
      ? Exclude<Resolved<Item>, undefined>[]
      : T extends object
        ? ResolvedRecord<T>
        : T;
