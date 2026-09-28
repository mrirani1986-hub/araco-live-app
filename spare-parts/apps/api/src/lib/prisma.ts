import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;
export { Prisma };

/** Run fn in a serializable-safe transaction with a generous timeout. */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 30_000, maxWait: 15_000 });
}
