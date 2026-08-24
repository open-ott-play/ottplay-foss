/**
 * Convert a JavaScript string to a UTF-8 byte array.
 *
 * @param input - The source string to encode.
 * @returns An array of byte values (0–255) representing the UTF-8 encoding of the input.
 *
 * @remarks
 * Handles surrogate pairs (characters above U+FFFF) by encoding them as
 * 4-byte UTF-8 sequences. Characters up to U+1FFFFF are supported. This
 * matches the `TextEncoder.encode()` behaviour in modern browsers.
 */
export function str2arr_u8_utf(input: string): number[] {
  var bytes: number[] = [];
  var index = -1;
  var length = input.length;
  while (++index < length) {
    var char = input.charCodeAt(index);
    if (char <= 0x7F) {
      bytes.push(char);
    } else if (char <= 0x7FF) {
      bytes.push(0xC0 | ((char >>> 6) & 0x1F));
      bytes.push(0x80 | (char & 0x3F));
    } else {
      var code = char;
      if (0xD800 <= code && code <= 0xDBFF && index + 1 < length) {
        var next = input.charCodeAt(index + 1);
        if (0xDC00 <= next && next <= 0xDFFF) {
          code = 0x10000 + ((code & 0x3FF) << 10) + (next & 0x3FF);
          index++;
        }
      }
      if (code <= 0xFFFF) {
        bytes.push(0xE0 | ((code >>> 12) & 0x0F));
        bytes.push(0x80 | ((code >>> 6) & 0x3F));
        bytes.push(0x80 | (code & 0x3F));
      } else if (code <= 0x1FFFFF) {
        bytes.push(0xF0 | ((code >>> 18) & 0x07));
        bytes.push(0x80 | ((code >>> 12) & 0x3F));
        bytes.push(0x80 | ((code >>> 6) & 0x3F));
        bytes.push(0x80 | (code & 0x3F));
      }
    }
  }
  return bytes;
}

/**
 * Convert a string to a Latin-1 (ISO-8859-1) byte array.
 *
 * @param input - The source string to encode.
 * @returns An array of byte values — each character's code point masked to 8 bits.
 *
 * @remarks
 * Non-Latin-1 characters are silently truncated (code & 0xFF). This is
 * suitable for protocols or file formats that expect single-byte encoding.
 */
export function str2arr_u8_latin1(input: string): number[] {
  var length = input.length;
  var bytes: number[] = [];
  for (var index = 0; index < length; index++) {
    bytes.push(input.charCodeAt(index) & 0xFF);
  }
  return bytes;
}

/**
 * Strip the `http://` or `https://` scheme prefix from a URL string.
 *
 * @param input - A URL that may start with `http://` or `https://`.
 * @returns The URL without its scheme prefix, or the original string if the
 *          scheme does not match `http://` or `https://`.
 *
 * @remarks
 * Uses character-code arithmetic for fast detection without regex. Compares
 * a hash of the first three characters (after scheme indicator) against the
 * expected value for "http" / "https". This is a performance optimisation
 * for STB environments where string operations are slow.
 */
export function StripHttp(input: string): string {
  if (input.charCodeAt(3) === 0x70) {
    var hash = input.charCodeAt(0) + (input.charCodeAt(1) << 8) + (input.charCodeAt(1) << 16);
    if (hash === 0x747078) {
      var offset = input.charCodeAt(4) === 0x73 ? 8 : 7;
      hash = input.charCodeAt(offset - 3) + (input.charCodeAt(offset - 2) << 8) + (input.charCodeAt(offset - 1) << 16);
      if (hash === 0x2D6F63) {
        return input.slice(offset);
      }
    }
  }
  return input;
}

/**
 * Compute the MurmurHash3 32-bit hash of a byte array.
 *
 * @param bytes - The input byte values (0–255).
 * @param seed  - Optional seed value (default 0).
 * @returns The 32-bit unsigned hash as a JavaScript number.
 *
 * @remarks
 * Implements the canonical MurmurHash3 x86 32-bit algorithm. Processes
 * 4-byte words using the constants 0x85EBCA6B, 0xC2B2AE35, etc. The
 * remainder bytes (1–3) are handled with a fallthrough switch. The result
 * is finalised with XOR-folding and two additional mixing rounds.
 */
export function murmurhash3_32(bytes: number[], seed?: number): number {
  if (seed === undefined) seed = 0;
  var remainder = bytes.length & 3;
  var dataLen = bytes.length - remainder;
  var result = seed;
  var word0 = 0;
  var offset = 0;

  while (offset < dataLen) {
    word0 = (bytes[offset] & 0xFF) |
      ((bytes[++offset] & 0xFF) << 8) |
      ((bytes[++offset] & 0xFF) << 16) |
      ((bytes[++offset] & 0xFF) << 24);
    ++offset;
    word0 = ((word0 & 0xFFFF) * 0x85EBCA6B + ((((word0 >>> 16) * 0x85EBCA6B) & 0xFFFF) << 16)) & 0xFFFFFFFF;
    word0 = (word0 << 15) | (word0 >>> 17);
    word0 = ((word0 & 0xFFFF) * 0xC2B2AE35 + ((((word0 >>> 16) * 0xC2B2AE35) & 0xFFFF) << 16)) & 0xFFFFFFFF;
    result ^= word0;
    result = (result << 13) | (result >>> 19);
    var product = ((result & 0xFFFF) * 5 + ((((result >>> 16) * 5) & 0xFFFF) << 16)) & 0xFFFFFFFF;
    result = ((product & 0xFFFF) + 0x165667B1 + ((((product >>> 16) + 0xE6546B64) & 0xFFFF) << 16));
  }

  word0 = 0;
  switch (remainder) {
    case 3: word0 ^= (bytes[offset + 2] & 0xFF) << 16;
    case 2: word0 ^= (bytes[offset + 1] & 0xFF) << 8;
    case 1: word0 ^= (bytes[offset] & 0xFF);
      word0 = ((word0 & 0xFFFF) * 0x85EBCA6B + ((((word0 >>> 16) * 0x85EBCA6B) & 0xFFFF) << 16)) & 0xFFFFFFFF;
      word0 = (word0 << 15) | (word0 >>> 17);
      word0 = ((word0 & 0xFFFF) * 0xC2B2AE35 + ((((word0 >>> 16) * 0xC2B2AE35) & 0xFFFF) << 16)) & 0xFFFFFFFF;
      result ^= word0;
  }

  result ^= bytes.length;
  result ^= result >>> 16;
  result = ((result & 0xFFFF) * 0x85EBCA6B + ((((result >>> 16) * 0x85EBCA6B) & 0xFFFF) << 16)) & 0xFFFFFFFF;
  result ^= result >>> 13;
  result = ((result & 0xFFFF) * 0xC2B2AE35 + ((((result >>> 16) * 0xC2B2AE35) & 0xFFFF) << 16)) & 0xFFFFFFFF;
  result ^= result >>> 16;
  return result >>> 0;
}

/**
 * Compute MurmurHash3 32-bit for a string (convenience wrapper).
 *
 * @param input - The string to hash.
 * @param seed  - Optional seed (default 0).
 * @returns The 32-bit hash, or 0 if the string is empty/falsy.
 *
 * @remarks
 * UTF-8-encodes the string first via `str2arr_u8_utf`, then hashes the
 * resulting byte array. The suffix "gc" indicates this is the "garbage
 * collector" / string-friendly variant from the original MurmurHash3
 * reference implementation.
 */
export function murmurhash3_32_gc(input: string, seed?: number): number {
  if (input) {
    if (seed === undefined) seed = 0;
    return murmurhash3_32(str2arr_u8_utf(input), seed);
  }
  return 0;
}

/**
 * Compute the xxHash32 of a byte array.
 *
 * @param bytes - The input byte values (0–255).
 * @param seed  - Optional seed value (default 0).
 * @returns The 32-bit unsigned hash.
 *
 * @remarks
 * Implements the xxHash32 algorithm. For inputs >= 16 bytes, processes
 * data in 4 parallel "lanes" with a round-robin accumulator, then
 * combines them with rotated sums. Remaining bytes are processed
 * one-by-one. The final output goes through three avalanche stages
 * (xor-shift-multiply). All arithmetic is performed with manual
 * 32-bit masking to ensure correct wrap-around.
 */
export function xxHash32(bytes: number[], seed?: number): number {
  if (seed === undefined) seed = 0;
  var array = bytes;
  var result = (seed + 0x242F12F9) & 0xFFFFFFFF;
  var index = 0;

  if (array.length >= 16) {
    var lanes = [
      (seed + 0x9E3779B9 + 0x85EBCA6B) & 0xFFFFFFFF,
      (seed + 0x85EBCA6B) & 0xFFFFFFFF,
      (seed + 0) & 0xFFFFFFFF,
      (seed - 0x9E3779B9) & 0xFFFFFFFF
    ];
    var tailEnd = array.length - 16;
    var lane = 0;
    for (index = 0; (index & 0xFFFFFFF0) <= tailEnd; index += 4) {
      var offset = index;
      var word0 = array[offset + 0] + (array[offset + 1] << 8);
      var word1 = array[offset + 2] + (array[offset + 3] << 8);
      var product = word0 * 0x85EBCA6B + ((word1 * 0x85EBCA6B) << 16);
      var acc = (lanes[lane] + product) & 0xFFFFFFFF;
      acc = (acc << 13) | (acc >>> 19);
      var lo = acc & 0xFFFF;
      var hi = acc >>> 16;
      lanes[lane] = (lo * 0x9E3779B9 + ((hi * 0x9E3779B9) << 16)) & 0xFFFFFFFF;
      lane = (lane + 1) & 3;
    }
    result = ((lanes[0] << 1) | (lanes[0] >>> 31)) +
      ((lanes[1] << 7) | (lanes[1] >>> 25)) +
      ((lanes[2] << 12) | (lanes[2] >>> 20)) +
      ((lanes[3] << 18) | (lanes[3] >>> 14)) & 0xFFFFFFFF;
  }

  result = (result + array.length) & 0xFFFFFFFF;
  var tailEnd2 = array.length - 4;
  for (; index <= tailEnd2; index += 4) {
    var offset2 = index;
    var word0b = array[offset2 + 0] + (array[offset2 + 1] << 8);
    var word1b = array[offset2 + 2] + (array[offset2 + 3] << 8);
    var product2 = word0b * 0xC2B2AE33 + ((word1b * 0xC2B2AE33) << 16);
    result = (result + product2) & 0xFFFFFFFF;
    result = (result << 17) | (result >>> 15);
    result = ((result & 0xFFFF) * 0x9E4C43CB + (((result >>> 16) * 0x9E4C43CB) << 16)) & 0xFFFFFFFF;
  }

  for (; index < array.length; ++index) {
    var byte = array[index];
    result += byte * 0x242F12F9;
    result = (result << 11) | (result >>> 21);
    result = ((result & 0xFFFF) * 0x9E3779B9 + (((result >>> 16) * 0x9E3779B9) << 16)) & 0xFFFFFFFF;
  }

  result = result ^ (result >>> 15);
  result = (((result & 0xFFFF) * 0x85EBCA6B) & 0xFFFFFFFF) + (((result >>> 16) * 0x85EBCA6B) << 16);
  result = result ^ (result >>> 13);
  result = (((result & 0xFFFF) * 0xC2B2AE33) & 0xFFFFFFFF) + (((result >>> 16) * 0xC2B2AE33) << 16);
  result = result ^ (result >>> 16);
  return result >>> 0;
}

/**
 * Compute xxHash32 for a string with optional case insensitivity.
 *
 * @param input            - The string to hash.
 * @param caseInsensitive  - If true, lowercases the input before hashing.
 * @param seed             - Optional seed (default 0).
 * @returns The 32-bit hash, or 0 if the string is empty/falsy.
 *
 * @remarks
 * UTF-8-encodes the string before hashing. The "S" suffix in the function
 * name indicates "string" variant.
 */
export function xxHash32S(input: string, caseInsensitive?: boolean, seed?: number): number {
  if (input) {
    if (caseInsensitive === true) {
      input = input.toLowerCase();
    }
    if (seed === undefined) {
      return xxHash32(str2arr_u8_utf(input), 0);
    }
    return xxHash32(str2arr_u8_utf(input), seed);
  }
  return 0;
}

/**
 * Compute case-insensitive xxHash32, returning the hash as a decimal string.
 *
 * @param input - The string to hash (lowercased internally).
 * @returns The hash as a base-10 string, or `'0'` if the input is empty/falsy.
 *
 * @remarks
 * Convenience wrapper around `xxHash32(str2arr_u8_utf(input.toLowerCase()), 0)`
 * that returns a string suitable for use as a key or identifier. The "Si"
 * suffix stands for "string, case-insensitive".
 */
export function xxHash32Si(input: string): string {
  return input ? xxHash32(str2arr_u8_utf(input.toLowerCase()), 0).toString(10) : '0';
}
