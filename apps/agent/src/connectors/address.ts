import { getAddress, isAddress } from "viem"

/**
 * Pull a payout address out of text a contributor wrote.
 *
 * This is the single most dangerous function in the worker. Everything else
 * decides how much someone is owed; this decides who gets it, from a string
 * that an attacker controls and a tired person typed. An address that is wrong
 * by one character is not a bug report, it is money gone with no way back.
 *
 * So it is deliberately strict and deliberately boring.
 *
 * A mixed-case address MUST pass its EIP-55 checksum. That is the whole reason
 * the checksum exists: every wallet and block explorer emits the mixed-case
 * form, so a copy-paste that lost or gained a character fails here instead of
 * at the point where funds move. An all-lowercase or all-uppercase address
 * carries no checksum to verify, so it is accepted, and the person is relying
 * on having typed it correctly.
 *
 * More than one distinct address in one body is refused outright rather than
 * resolved by picking the first. A body with two addresses is either someone
 * quoting a previous comment, a template nobody filled in, or an attempt to
 * confuse the reader, and none of those should be guessed at.
 */

/** 0x followed by exactly 40 hex characters, not part of a longer run. */
const ADDRESS = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g

/**
 * Addresses that are never a payout destination.
 *
 * The zero address and the classic burn addresses show up in documentation,
 * test fixtures and example snippets constantly. Paying one is indistinguishable
 * from destroying the money.
 */
const UNPAYABLE = new Set(
  [
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
    "0xffffffffffffffffffffffffffffffffffffffff",
  ].map((a) => a.toLowerCase())
)

export type AddressRejection =
  | "none_found"
  | "bad_checksum"
  | "several_found"
  | "unpayable"

export interface AddressResult {
  /** Lowercased, ready to store. Null when nothing usable was found. */
  address: string | null
  /** Why nothing was returned, for the record and for the contributor. */
  rejected: AddressRejection | null
  /** What was seen, so a person can be told what we read rather than guess. */
  seen: string[]
}

/**
 * Find the one address in this text, or explain why there isn't one.
 *
 * Run against ALREADY CLEANED text. Hygiene strips HTML comments and
 * zero-width characters first, which matters here more than anywhere: an
 * address hidden in a comment, or one broken up by zero-width joiners so it
 * reads differently to a human than to this function, is precisely the trick
 * this ordering defeats.
 */
export function findPayoutAddress(text: string | null | undefined): AddressResult {
  if (!text) return { address: null, rejected: "none_found", seen: [] }

  const matches = text.match(ADDRESS) ?? []
  if (matches.length === 0) return { address: null, rejected: "none_found", seen: [] }

  // Distinct by value, not by spelling: the same address written once in
  // lowercase and once checksummed is one address, not two.
  const distinct = [...new Set(matches.map((m) => m.toLowerCase()))]

  if (distinct.length > 1) {
    return { address: null, rejected: "several_found", seen: distinct }
  }

  const lower = distinct[0]!
  if (UNPAYABLE.has(lower)) {
    return { address: null, rejected: "unpayable", seen: distinct }
  }

  // The checksum check, on the spelling as written. `isAddress` in strict mode
  // accepts an all-one-case address and enforces EIP-55 on a mixed-case one,
  // which is exactly the rule we want.
  const asWritten = matches.find((m) => m.toLowerCase() === lower)!
  // Compare the hex body only. Including the `0x` made an all-caps address
  // look mixed-case, because `"0x".toUpperCase()` is `"0X"`, and it was then
  // rejected for failing a checksum it never claimed to carry.
  const body = asWritten.slice(2)
  const isMixedCase = body !== body.toLowerCase() && body !== body.toUpperCase()

  if (isMixedCase && !isAddress(asWritten, { strict: true })) {
    return { address: null, rejected: "bad_checksum", seen: [asWritten] }
  }
  if (!isAddress(asWritten, { strict: false })) {
    return { address: null, rejected: "bad_checksum", seen: [asWritten] }
  }

  return { address: lower, rejected: null, seen: distinct }
}

/**
 * Check one address a PLATFORM handed us, rather than one a person typed.
 *
 * FOMO holds a custodial wallet per account and returns it for any user id, so
 * a callout author never types an address at all. That field still goes through
 * the same gate: an upstream that starts returning the zero address, or a
 * truncated one, must fail here and not at the point where funds move.
 *
 * No scraping and no "several found", because there is exactly one candidate.
 */
export function checkPayoutAddress(raw: string | null | undefined): AddressResult {
  const candidate = (raw ?? "").trim()
  if (!candidate) return { address: null, rejected: "none_found", seen: [] }

  // Whole string, anchored. `findPayoutAddress` scans prose and so tolerates
  // text around a match; a dedicated field with anything around it is a field
  // we have misread, and guessing at the hex inside would be the worst answer.
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate)) {
    return { address: null, rejected: "bad_checksum", seen: [candidate] }
  }

  const lower = candidate.toLowerCase()
  if (UNPAYABLE.has(lower)) return { address: null, rejected: "unpayable", seen: [candidate] }

  // Same rule as a typed address: enforce EIP-55 only when the spelling claims
  // one. Compare the hex body, since `"0x".toUpperCase()` is `"0X"` and made an
  // all-caps address look mixed-case.
  const body = candidate.slice(2)
  const isMixedCase = body !== body.toLowerCase() && body !== body.toUpperCase()
  if (isMixedCase && !isAddress(candidate, { strict: true })) {
    return { address: null, rejected: "bad_checksum", seen: [candidate] }
  }

  return { address: lower, rejected: null, seen: [lower] }
}

/** Checksummed form, for showing an address back to a person. */
export function displayAddress(lower: string): string {
  return getAddress(lower)
}

/** What to print on the record when no address could be used. */
export function rejectionReason(r: AddressRejection, seen: string[]): string {
  switch (r) {
    case "none_found":
      return "No wallet address in the description."
    case "bad_checksum":
      return `The address ${seen[0] ?? ""} failed its checksum, so it was not used. One wrong character sends funds nowhere.`
    case "several_found":
      return `${seen.length} different addresses in one description, so none was used.`
    case "unpayable":
      return "That address cannot receive a payout."
  }
}
