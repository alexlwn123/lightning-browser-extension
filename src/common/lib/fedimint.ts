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

interface MeltQuoteResponse {
  quote: string;
  amount: number;
  fee_reserve: number;
  paid: boolean;
  expiry: number;
}

interface MeltResponse {
  paid: boolean;
  payment_preimage?: string;
}

export function getDecodedToken(token: string): SerializedToken {
  // remove prefixes
  const uriPrefixes = ["web+cashu://", "cashu://", "cashu:"];
  uriPrefixes.forEach((prefix) => {
    if (token.startsWith(prefix)) {
      token = token.slice(prefix.length);
    }
  });
  if (!token.startsWith("cashuA")) {
    throw new Error("Invalid cashu token");
  }
  return handleTokens(token.replace("cashuA", ""));
}

function handleTokens(token: string): SerializedToken {
  const obj = JSON.parse(Buffer.from(token, "base64").toString());

  // check if v3
  if ("token" in obj) {
    return obj;
  }

  // check if v1
  if (Array.isArray(obj)) {
    return { token: [{ proofs: obj, mint: "" }] };
  }

  // if v2 token return v3 format
  return { token: [{ proofs: obj.proofs, mint: obj?.mints[0]?.url ?? "" }] };
}

// Function to request a melt quote
async function requestMeltQuote(
  mintHost: string,
  invoice: string
): Promise<MeltQuoteResponse> {
  const response = await fetch(`${mintHost}/v1/melt/quote/bolt11`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request: invoice, unit: "sat" }),
  });
  if (!response.ok) {
    throw new Error("Failed to request melt quote");
  }
  return await response.json();
}

// Function to melt tokens based on the quote
async function meltTokens(
  mintHost: string,
  quoteId: string,
  proofs: Proof[]
): Promise<MeltResponse> {
  const response = await fetch(`${mintHost}/v1/melt/bolt11`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quote: quoteId, inputs: proofs }),
  });
  if (!response.ok) {
    throw new Error("Failed to melt tokens");
  }
  return await response.json();
}

// Main function to handle the melting process
export async function cashuMeltTokens(
  tokens: string | SerializedToken
): Promise<number> {
  const decodedTokens =
    typeof tokens === "string" ? getDecodedToken(tokens) : tokens;
  let totalMelted = 0;

  for (const token of decodedTokens.token) {
    const mintHost = token.mint;
    const proofs = token.proofs;
    const totalTokensSats = proofs.reduce(
      (sum, proof) => sum + proof.amount,
      0
    );

    // Request an invoice for the amount to melt
    const invoice = await api.makeInvoice({
      amount: totalTokensSats,
      memo: "cashu melt",
    });

    // Request a melt quote
    const meltQuote = await requestMeltQuote(mintHost, invoice.paymentRequest);

    // Melt tokens using the quote
    const meltData = await meltTokens(mintHost, meltQuote.quote, proofs);
    if (!meltData.paid) {
      throw new Error("Payment failed");
    }

    totalMelted += totalTokensSats; // Adjust according to actual melted amount if necessary
  }

  return totalMelted;
}
