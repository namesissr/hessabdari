import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** BigInt-safe JSON برای ارسال به کلاینت */
export function serialize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
