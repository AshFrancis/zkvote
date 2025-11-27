const fs = require("fs");

// Convert verification key from snarkjs format to Soroban format (LITTLE-ENDIAN)
// This is for older quickstart:future (before PR #1614) which uses LE encoding
// G2 format: c0||c1 (real first, then imaginary) in little-endian

function bigintToBytesLE(bigint, length) {
  // Little-endian: LSB first
  const hex = bigint.toString(16).padStart(length * 2, "0");
  const bytes = [];
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

function g1ToBytesLE(point) {
  // G1 point: [x, y] -> 64 bytes (32 for x, 32 for y) in little-endian
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);
  return [...bigintToBytesLE(x, 32), ...bigintToBytesLE(y, 32)];
}

function g2ToBytesLE(point) {
  // G2 point: [[c0, c1], [c0, c1]] -> 128 bytes
  // OLD format: c0||c1 (real first, then imaginary) in little-endian
  // snarkjs gives us [[c0, c1], [c0, c1]]
  const x = point[0];
  const y = point[1];

  // OLD LE format: c0 then c1
  const x_c0 = BigInt(x[0]); // real part
  const x_c1 = BigInt(x[1]); // imaginary part
  const y_c0 = BigInt(y[0]); // real part
  const y_c1 = BigInt(y[1]); // imaginary part

  return [
    ...bigintToBytesLE(x_c0, 32),
    ...bigintToBytesLE(x_c1, 32),
    ...bigintToBytesLE(y_c0, 32),
    ...bigintToBytesLE(y_c1, 32)
  ];
}

function convertVerificationKeyLE(vkeyPath) {
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));

  const sorobanVkey = {
    protocol: vkey.protocol,
    curve: vkey.curve,
    nPublic: vkey.nPublic,

    // G1 points (64 bytes each) in LE
    alpha: g1ToBytesLE(vkey.vk_alpha_1),

    // G2 points (128 bytes each) in LE
    beta: g2ToBytesLE(vkey.vk_beta_2),
    gamma: g2ToBytesLE(vkey.vk_gamma_2),
    delta: g2ToBytesLE(vkey.vk_delta_2),

    // IC array (G1 points)
    ic: vkey.IC.map(g1ToBytesLE)
  };

  return sorobanVkey;
}

function toHexString(bytes) {
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

if (require.main === module) {
  const vkeyPath = process.argv[2] || "build/verification_key.json";

  if (!fs.existsSync(vkeyPath)) {
    console.error(`Error: Verification key not found at ${vkeyPath}`);
    console.error("Run ./compile.sh first to generate the verification key");
    process.exit(1);
  }

  console.log("Converting verification key to Soroban LE format (old quickstart:future)...\n");

  const sorobanVkey = convertVerificationKeyLE(vkeyPath);

  console.log("=== Verification Key (Hex, Little-Endian) ===");
  console.log(`Alpha (G1, 64 bytes): ${toHexString(sorobanVkey.alpha)}`);
  console.log(`Beta  (G2, 128 bytes): ${toHexString(sorobanVkey.beta)}`);
  console.log(`Gamma (G2, 128 bytes): ${toHexString(sorobanVkey.gamma)}`);
  console.log(`Delta (G2, 128 bytes): ${toHexString(sorobanVkey.delta)}`);
  console.log(`IC (${sorobanVkey.ic.length} G1 points):`);
  sorobanVkey.ic.forEach((ic, i) => {
    console.log(`  IC[${i}]: ${toHexString(ic)}`);
  });

  // Save JSON format
  const outputPath = vkeyPath.replace(".json", "_soroban_le.json");
  fs.writeFileSync(outputPath, JSON.stringify({
    alpha: toHexString(sorobanVkey.alpha),
    beta: toHexString(sorobanVkey.beta),
    gamma: toHexString(sorobanVkey.gamma),
    delta: toHexString(sorobanVkey.delta),
    ic: sorobanVkey.ic.map(toHexString)
  }, null, 2));

  console.log(`\nSaved to ${outputPath}`);
}

module.exports = { convertVerificationKeyLE, g1ToBytesLE, g2ToBytesLE };
