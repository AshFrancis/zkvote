// Conversion utility functions for BN254 point serialization
// Extracted for unit testing

/**
 * Convert bigint to 32-byte hex string in LITTLE-ENDIAN format
 * Soroban BN254 host functions expect little-endian byte order!
 *
 * @param {bigint} n - Field element as bigint
 * @returns {string} 64-character hex string (32 bytes, little-endian)
 */
function toLE32ByteHex(n) {
    const hex = n.toString(16).padStart(64, '0');
    // Reverse byte order: big-endian → little-endian
    const bytes = hex.match(/.{2}/g);  // Split into bytes
    return bytes.reverse().join('');    // Reverse and rejoin
}

/**
 * Convert G1 point (affine coordinates) to Soroban format
 * G1 point: [x, y, z] where z should be 1 for affine
 * Output: 64 bytes (32-byte x LE, 32-byte y LE)
 *
 * @param {Array<string>} point - [x, y, z] as decimal strings
 * @returns {string} 128-character hex string (64 bytes)
 */
function convertG1Point(point) {
    const x = toLE32ByteHex(BigInt(point[0]));
    const y = toLE32ByteHex(BigInt(point[1]));
    return x + y;
}

/**
 * Convert G2 point (affine coordinates in Fq2) to Soroban format
 * G2 point: [[x1, x2], [y1, y2], [z1, z2]] where z should be [1, 0] for affine
 * Output: 128 bytes (32-byte x1 LE, 32-byte x2 LE, 32-byte y1 LE, 32-byte y2 LE)
 *
 * IMPORTANT: Natural Fq2 element ordering [x1, x2, y1, y2] (NOT reversed!)
 * Where x = x1 + x2·u in Fq2 field extension
 *
 * @param {Array<Array<string>>} point - [[x1, x2], [y1, y2], [z1, z2]] as decimal strings
 * @returns {string} 256-character hex string (128 bytes)
 */
function convertG2Point(point) {
    // Natural order (NOT reversed) for Fq2 elements
    const x1 = toLE32ByteHex(BigInt(point[0][0]));
    const x2 = toLE32ByteHex(BigInt(point[0][1]));
    const y1 = toLE32ByteHex(BigInt(point[1][0]));
    const y2 = toLE32ByteHex(BigInt(point[1][1]));

    return x1 + x2 + y1 + y2;
}

/**
 * Convert snarkjs Groth16 proof to Soroban format
 *
 * @param {Object} proof - snarkjs proof object with pi_a, pi_b, pi_c
 * @returns {Object} Soroban proof with a, b, c as hex strings
 */
function convertProofToSoroban(proof) {
    return {
        a: convertG1Point(proof.pi_a),
        b: convertG2Point(proof.pi_b),
        c: convertG1Point(proof.pi_c)
    };
}

/**
 * Convert snarkjs verification key to Soroban format
 *
 * @param {Object} vkey - snarkjs verification key
 * @returns {Object} Soroban VK with alpha, beta, gamma, delta, ic
 */
function convertVKeyToSoroban(vkey) {
    // Convert IC points (array of G1 points)
    const ic = vkey.IC.map(point => convertG1Point(point));

    return {
        alpha: convertG1Point(vkey.vk_alpha_1),
        beta: convertG2Point(vkey.vk_beta_2),
        gamma: convertG2Point(vkey.vk_gamma_2),
        delta: convertG2Point(vkey.vk_delta_2),
        ic
    };
}

/**
 * Reverse a hex string byte-by-byte
 * Used for converting between big-endian and little-endian
 *
 * @param {string} hex - Hex string (even length)
 * @returns {string} Byte-reversed hex string
 */
function reverseHexBytes(hex) {
    const bytes = hex.match(/.{2}/g);
    return bytes.reverse().join('');
}

module.exports = {
    toLE32ByteHex,
    convertG1Point,
    convertG2Point,
    convertProofToSoroban,
    convertVKeyToSoroban,
    reverseHexBytes
};
