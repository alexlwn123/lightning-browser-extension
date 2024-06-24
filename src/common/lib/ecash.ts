import { Buffer } from "buffer";
import api from "~/common/lib/api";

interface Proof {
  id: string;
  amount: number;
  secret: string;
  C: string;
}

interface Token {
  mint: string;
  proofs: Proof[];
}

export interface SerializedToken {
  token: Token[];
  unit?: string;
  memo?: string;
}

type MeltQuoteResponse = {
  quote: string; // Id of the cashu quote
  amount: number;
  fee_reserve: number;
};

type MeltPayload = {
  quote: string;
  inputs: Array<Proof>;
};

type MeltQuote = {
  mintHost: string;
  meltPayload: MeltPayload;
  amount: number;
  fees: number;
};

export type MeltSummary = {
  quotes: MeltQuote[];
  totalFees: number;
  totalAmount: number;
};

export type MeltResult = {
  mSats: number;
};

// TODO: Add complete validation
export function validateCashuTokens(raw: string) {
  let token = raw;
  const uriPrefixes = ["web+cashu://", "cashu://", "cashu:"];
  uriPrefixes.forEach((prefix) => {
    if (token.startsWith(prefix)) {
      token = token.slice(prefix.length);
    }
  });
  if (!token.startsWith("cashuA")) {
    throw new Error("Invalid cashu token");
  }
  return token;
}

// Takes cashu note, parses it into individual tokens for each mint
// Then, we melt for each mint (convert to lightning invoices and pay self)
export function decodeCashuTokens(raw: string): SerializedToken {
  // remove prefixes
  const token = validateCashuTokens(raw);
  const rawToken = token.replace("cashuA", "");

  const parsedTokenBuffer = JSON.parse(
    Buffer.from(rawToken, "base64").toString()
  );
  // check if v3
  if ("token" in parsedTokenBuffer && Array.isArray(parsedTokenBuffer.token)) {
    return parsedTokenBuffer;
  }
  // if v2 token return v3 format
  if (
    "proofs" in parsedTokenBuffer &&
    "mints" in parsedTokenBuffer &&
    parsedTokenBuffer.mints.length > 0 &&
    parsedTokenBuffer.mints[0].url
  ) {
    return {
      token: [
        {
          proofs: parsedTokenBuffer.proofs,
          mint: parsedTokenBuffer.mints[0].url,
        },
      ],
    };
  }
  // check if v1
  if (Array.isArray(parsedTokenBuffer)) {
    throw new Error("v1 cashu tokens are not supported");
  }

  throw new Error("No valid ecash proofs found");
}

// Given a lightning invoice, the cashu mint responds with a quoted
// amount of cashu ecash tokens to pay.
// Need to call this for each parsed token that belongs to a different mint
async function getMeltQuote(
  mintHost: string,
  invoice: string
): Promise<MeltQuoteResponse> {
  const feeResponse = await fetch(`${mintHost}/v1/melt/quote/bolt11`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request: invoice, unit: "sat" }),
  });
  const json = await feeResponse.json();

  return json;
}

// Pays the invoice
/**
 * @param mintHost URL of the cashu mint
 * @param payload contains quoteId and ecash to pay the quote
 * @returns the result after paying the invoice from the cashu mint
 */
async function meltTokens(mintHost: string, payload: MeltPayload) {
  // TODO: Move this fetch into Alby's apis
  const response = await fetch(`${mintHost}/v1/melt/bolt11`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return await response.json();
}

async function buildMeltPayload(
  meltQuoteId: string,
  proofs: Proof[]
): Promise<MeltPayload> {
  const meltPayload: MeltPayload = {
    quote: meltQuoteId,
    inputs: proofs,
  };
  return meltPayload;
}

// Tries to create an invoice
async function getInvoiceFee(amount: number, mintHost: string) {
  const invoice = await api.makeInvoice({
    amount: amount,
    memo: "cashu melt",
  });
  const meltQuote = await getMeltQuote(mintHost, invoice.paymentRequest);
  const { fee_reserve } = meltQuote;
  return fee_reserve;
}

// After we have a quote for melting ecash,
// we need to an "updated" quote that includes the new fees
async function getUpdatedMeltQuote(
  amount: number,
  mintHost: string
): Promise<{
  amount: number;
  meltQuoteId: string;
  quoteFeeReserve: number;
}> {
  // Start with max fee to ensure at least 1 melt quote attempt
  // If the fees are <= fee reserve it continues with the melt otherwise it makes another invoice using the new fees
  const targetFee = await getInvoiceFee(amount, mintHost);

  // TODO: Add retrying
  const candidateAmount = (amount - targetFee) as number;
  const candidateInvoice = await api.makeInvoice({
    amount: candidateAmount,
    memo: "cashu melt",
  });
  const quote = await getMeltQuote(mintHost, candidateInvoice.paymentRequest);

  return {
    amount: quote.amount, // Amount you get paid (with fees deducted)
    meltQuoteId: quote.quote,
    quoteFeeReserve: quote.fee_reserve,
  };
}

/**
 *  After a cashu note is scanned, we want to convert the ecash tokens into fedimint.
 *  We do this by generating lightning invoices from the user's fedimint wallet for each cashu token
 *  and then paying the invoices from the cashu mint.
 *
 * @param tokens Cashu Tokens to melt (ecash --> lightning receive into fedimint)
 * @param fedimint Bridge
 * @param federationId federationId of the destination for melted ecash tokens
 * @returns
 */
export async function getMeltQuotes(
  tokens: string | SerializedToken
  // federationId: string | undefined
): Promise<MeltSummary> {
  const decodedTokens =
    typeof tokens === "string" ? decodeCashuTokens(tokens) : tokens;

  const quotes: MeltQuote[] = [];

  // Iterate over each token
  for (const token of decodedTokens.token) {
    const mintHost = token.mint;
    const proofs = token.proofs;

    // Check if we have enough tokens
    const totalTokensSats = proofs.reduce(
      (sum, proof) => sum + proof.amount,
      0
    );

    // amountMsats is the amount you get paid (with fees deducted)
    const { amount, meltQuoteId, quoteFeeReserve } = await getUpdatedMeltQuote(
      totalTokensSats,
      mintHost
    );

    // Build the melt payload
    const meltPayload = await buildMeltPayload(meltQuoteId, proofs);

    quotes.push({
      mintHost,
      meltPayload,
      amount,
      fees: quoteFeeReserve,
    });
  }
  const totalFees = quotes.reduce((sum, quote) => sum + quote.fees, 0);
  const totalAmount = quotes.reduce((sum, quote) => sum + quote.amount, 0);
  // calculate total values/fees by summing quotes
  return {
    quotes,
    totalFees,
    totalAmount,
  };
}

/**
 *
 * Takes a list of melt quotes and executes them
 *
 * @param quotes List of melt quotes
 * @returns MeltResult
 */
export async function executeMelts(
  meltSummary: MeltSummary
): Promise<MeltResult> {
  let totalMelted = 0;
  for (const quote of meltSummary.quotes) {
    const { mintHost, meltPayload, amount } = quote;
    const meltData = await meltTokens(mintHost, meltPayload);
    if (!meltData.paid) {
      throw new Error("Payment failed");
    }
    // Add the amount melted for this token to the total
    totalMelted = totalMelted + amount;
  }

  return { mSats: totalMelted };
}
