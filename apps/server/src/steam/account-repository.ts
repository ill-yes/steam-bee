import { ERROR_CODES } from "@steam-bee/contracts";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { steamAccount } from "../db/schema.js";
import { appError } from "../http/errors.js";

export async function getAccountOrThrow(accountId: string) {
  const account = await db.query.steamAccount.findFirst({
    where: eq(steamAccount.id, accountId),
  });
  if (!account) {
    throw appError(
      "Steam account was not found.",
      404,
      ERROR_CODES.accountNotFound,
    );
  }
  return account;
}
