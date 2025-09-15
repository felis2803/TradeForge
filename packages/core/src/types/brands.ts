export type brand<T, B extends string> = T & { readonly __brand: B };
