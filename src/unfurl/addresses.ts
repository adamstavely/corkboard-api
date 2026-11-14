import { isIP } from 'node:net';

/**
 * Which addresses the server may connect to on someone's say-so (link previews, issue trackers): public ones only.
 * Addresses are classified by their bytes, so every way of writing one (dotted, hexadecimal, IPv4 inside IPv6) is the
 * same address. Anything special-use is refused: this machine, private and shared networks, link-local (cloud
 * metadata), multicast, documentation and benchmark ranges, and IPv6 forms that carry an IPv4 address inside them are
 * judged by that IPv4 address.
 */

/** IPv4 ranges that aren't the public internet, as [first octets, prefix length]. */
const V4_DENIED: readonly [number[], number][] = [
  [[0], 8], // "this network"
  [[10], 8], // private
  [[100, 64], 10], // carrier-grade NAT
  [[127], 8], // loopback
  [[169, 254], 16], // link-local, cloud metadata
  [[172, 16], 12], // private
  [[192, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2], 24], // documentation
  [[192, 88, 99], 24], // 6to4 relay
  [[192, 168], 16], // private
  [[198, 18], 15], // benchmarking
  [[198, 51, 100], 24], // documentation
  [[203, 0, 113], 24], // documentation
  [[224], 4], // multicast
  [[240], 4], // reserved, and broadcast
];

function inPrefix(bytes: readonly number[], prefix: readonly number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const byte = Math.floor(i / 8);
    const mask = 0x80 >> (i % 8);
    if ((bytes[byte] & mask) !== ((prefix[byte] ?? 0) & mask)) return false;
  }
  return true;
}

const v4Denied = (b: readonly number[]) => V4_DENIED.some(([prefix, bits]) => inPrefix(b, prefix, bits));

/** An IPv6 address as its 16 bytes (a dotted IPv4 tail included), or null if it isn't one. */
export function ipv6Bytes(address: string): number[] | null {
  const a = address.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (isIP(a) !== 6) return null;
  let text = a;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const [p, q, r, s] = tail[1].split('.').map(Number);
    text = text.slice(0, -tail[1].length) + `${((p << 8) | q).toString(16)}:${((r << 8) | s).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const groups = rest === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

/** IPv6 ranges refused outright, as [first bytes, prefix length]. */
const V6_DENIED: readonly [number[], number][] = [
  [[0x01, 0x00], 64], // discard
  [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48], // local NAT64
  [[0x20, 0x01, 0x00, 0x00], 32], // Teredo (an IPv4 address in disguise)
  [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
  [[0xfc], 7], // unique local
  [[0xfe, 0x80], 10], // link-local
  [[0xfe, 0xc0], 10], // site-local (old)
  [[0xff], 8], // multicast
];

/** Whether the server must not connect to this address. Anything that isn't a well-formed address is refused too. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '');
  if (isIP(bare) === 4) return v4Denied(bare.split('.').map(Number));
  const b = ipv6Bytes(bare);
  if (!b) return true;
  const zeros = (n: number) => b.slice(0, n).every((x) => x === 0);
  // :: and ::1
  if (zeros(15) && b[15] <= 1) return true;
  // An IPv4 address carried inside: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d).
  if (zeros(10) && b[10] === 0xff && b[11] === 0xff) return v4Denied(b.slice(12));
  if (zeros(12)) return v4Denied(b.slice(12));
  if (inPrefix(b, [0x00, 0x64, 0xff, 0x9b], 96)) return v4Denied(b.slice(12));
  // 6to4 (2002:a.b.c.d::/48).
  if (b[0] === 0x20 && b[1] === 0x02) return v4Denied(b.slice(2, 6));
  return V6_DENIED.some(([prefix, bits]) => inPrefix(b, prefix, bits));
}

/**
 * Refuses a URL whose host is written as a private address. Needed as well as guarding DNS lookups: Node connects to
 * an address written in the URL without looking anything up.
 */
export function assertPublicHost(url: URL): void {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) throw new Error('That address is not allowed');
}
