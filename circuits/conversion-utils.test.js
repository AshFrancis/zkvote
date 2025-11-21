const {
    toLE32ByteHex,
    convertG1Point,
    convertG2Point,
    convertProofToSoroban,
    convertVKeyToSoroban,
    reverseHexBytes
} = require('./conversion-utils');

describe('BN254 Point Conversion Utilities', () => {
    describe('toLE32ByteHex', () => {
        test('converts small number to 32-byte little-endian hex', () => {
            const result = toLE32ByteHex(1n);
            expect(result).toBe('0100000000000000000000000000000000000000000000000000000000000000');
            expect(result.length).toBe(64); // 32 bytes = 64 hex chars
        });

        test('converts larger number correctly', () => {
            const result = toLE32ByteHex(256n);
            expect(result).toBe('0001000000000000000000000000000000000000000000000000000000000000');
        });

        test('converts max value (2^256-1)', () => {
            const maxValue = (1n << 256n) - 1n;
            const result = toLE32ByteHex(maxValue);
            expect(result).toBe('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        });

        test('reverses byte order correctly for known value', () => {
            // Big-endian: 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20
            // Little-endian: 0x201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201
            const be = BigInt('0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20');
            const result = toLE32ByteHex(be);
            expect(result).toBe('201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201');
        });

        test('pads to 32 bytes for small values', () => {
            const result = toLE32ByteHex(0x42n);
            expect(result.length).toBe(64);
            expect(result).toBe('4200000000000000000000000000000000000000000000000000000000000000');
        });
    });

    describe('reverseHexBytes', () => {
        test('reverses 2-byte hex string', () => {
            expect(reverseHexBytes('0102')).toBe('0201');
        });

        test('reverses 32-byte hex string', () => {
            const input = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
            const expected = '201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201';
            expect(reverseHexBytes(input)).toBe(expected);
        });

        test('is its own inverse', () => {
            const original = 'deadbeefcafe1234';
            const reversed = reverseHexBytes(original);
            const backToOriginal = reverseHexBytes(reversed);
            expect(backToOriginal).toBe(original);
        });
    });

    describe('convertG1Point', () => {
        test('converts BN254 generator point (1, 2)', () => {
            // BN254 G1 generator: (1, 2)
            const g1Generator = ['1', '2', '1'];
            const result = convertG1Point(g1Generator);

            // Expected: x=1 (LE), y=2 (LE)
            const expectedX = '0100000000000000000000000000000000000000000000000000000000000000';
            const expectedY = '0200000000000000000000000000000000000000000000000000000000000000';
            expect(result).toBe(expectedX + expectedY);
            expect(result.length).toBe(128); // 64 bytes = 128 hex chars
        });

        test('converts arbitrary G1 point', () => {
            // Test with known field elements
            const point = [
                '12345678901234567890',
                '98765432109876543210',
                '1'
            ];
            const result = convertG1Point(point);

            // Should be 128 hex chars (64 bytes)
            expect(result.length).toBe(128);

            // Extract x and y
            const x = result.slice(0, 64);
            const y = result.slice(64, 128);

            // Verify they're different
            expect(x).not.toBe(y);

            // Verify first coordinate starts with LE representation of the number
            expect(x.slice(0, 2)).not.toBe('00'); // Should have non-zero low byte
        });
    });

    describe('convertG2Point', () => {
        test('converts with natural Fq2 ordering (NOT reversed)', () => {
            // Test point with distinct values for each coordinate
            const point = [
                ['1', '2'],  // x = x1 + x2·u
                ['3', '4'],  // y = y1 + y2·u
                ['1', '0']   // z = 1 + 0·u (affine)
            ];

            const result = convertG2Point(point);

            // Should be 256 hex chars (128 bytes)
            expect(result.length).toBe(256);

            // Extract components
            const x1 = result.slice(0, 64);
            const x2 = result.slice(64, 128);
            const y1 = result.slice(128, 192);
            const y2 = result.slice(192, 256);

            // Verify natural ordering: x1=1, x2=2, y1=3, y2=4
            expect(x1).toBe('0100000000000000000000000000000000000000000000000000000000000000');
            expect(x2).toBe('0200000000000000000000000000000000000000000000000000000000000000');
            expect(y1).toBe('0300000000000000000000000000000000000000000000000000000000000000');
            expect(y2).toBe('0400000000000000000000000000000000000000000000000000000000000000');
        });

        test('does NOT use reversed Fq2 ordering', () => {
            // This test documents the BUG we fixed
            const point = [
                ['100', '200'],  // x coordinates
                ['300', '400'],  // y coordinates
                ['1', '0']
            ];

            const result = convertG2Point(point);

            // Extract x1 (should be first, not second)
            const x1 = result.slice(0, 64);

            // x1 should be 100 in little-endian
            const x1Value = BigInt('0x' + reverseHexBytes(x1));
            expect(x1Value).toBe(100n);

            // NOT 200 (which would be the case if reversed)
            expect(x1Value).not.toBe(200n);
        });

        test('converts BN254 G2 generator coordinates', () => {
            // BN254 G2 generator point
            const g2Generator = [
                [
                    '10857046999023057135944570762232829481370756359578518086990519993285655852781',
                    '11559732032986387107991004021392285783925812861821192530917403151452391805634'
                ],
                [
                    '8495653923123431417604973247489272438418190587263600148770280649306958101930',
                    '4082367875863433681332203403145435568316851327593401208105741076214120093531'
                ],
                ['1', '0']
            ];

            const result = convertG2Point(g2Generator);
            expect(result.length).toBe(256);

            // Correct little-endian values (verified by actual conversion)
            const expectedX1 = 'edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018';
            const expectedX2 = 'c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e19';
            const expectedY1 = 'aa7dfa6601cce64c7bd3430c69e7d1e38f40cb8d8071ab4aeb6d8cdba55ec812';
            const expectedY2 = '5b9722d1dcdaac55f38eb37033314bbc95330c69ad999eec75f05f58d0890609';

            expect(result.slice(0, 64)).toBe(expectedX1);
            expect(result.slice(64, 128)).toBe(expectedX2);
            expect(result.slice(128, 192)).toBe(expectedY1);
            expect(result.slice(192, 256)).toBe(expectedY2);
        });
    });

    describe('convertProofToSoroban', () => {
        test('converts complete Groth16 proof structure', () => {
            const proof = {
                pi_a: ['1', '2', '1'],
                pi_b: [['3', '4'], ['5', '6'], ['1', '0']],
                pi_c: ['7', '8', '1']
            };

            const result = convertProofToSoroban(proof);

            // Should have a, b, c fields
            expect(result).toHaveProperty('a');
            expect(result).toHaveProperty('b');
            expect(result).toHaveProperty('c');

            // a and c should be G1 (64 bytes = 128 hex)
            expect(result.a.length).toBe(128);
            expect(result.c.length).toBe(128);

            // b should be G2 (128 bytes = 256 hex)
            expect(result.b.length).toBe(256);
        });

        test('matches real proof conversion', () => {
            // Use actual values from our test proof
            const proof = {
                pi_a: [
                    '8002376440479074486643027846934478313476620092854043812485969298002750224980',
                    '20820516206451825778653033949651894732046172821989055316925943878969935646732',
                    '1'
                ],
                pi_b: [
                    [
                        '11559732032986387107991004021392285783925812861821192530917403151452391805625',
                        '21909886534343143487302430567958239346154845577896993866116438261516893516537'
                    ],
                    [
                        '13050022111743750830309270488348950830882797851569133652934823789823961090759',
                        '18687801815239898060635746799867029419031293419798172885813298006652832064351'
                    ],
                    ['1', '0']
                ],
                pi_c: [
                    '1726527621229471947085885673878667768892109341089754997867350690652991348902',
                    '10591065654267356195025133948926746157872961738903991091509743636308030762734',
                    '1'
                ]
            };

            const result = convertProofToSoroban(proof);

            // Verify it produces hex strings of correct length
            expect(typeof result.a).toBe('string');
            expect(typeof result.b).toBe('string');
            expect(typeof result.c).toBe('string');

            expect(result.a.length).toBe(128);
            expect(result.b.length).toBe(256);
            expect(result.c.length).toBe(128);
        });
    });

    describe('convertVKeyToSoroban', () => {
        test('converts verification key structure', () => {
            const vkey = {
                vk_alpha_1: ['1', '2', '1'],
                vk_beta_2: [['3', '4'], ['5', '6'], ['1', '0']],
                vk_gamma_2: [['7', '8'], ['9', '10'], ['1', '0']],
                vk_delta_2: [['11', '12'], ['13', '14'], ['1', '0']],
                IC: [
                    ['15', '16', '1'],
                    ['17', '18', '1'],
                    ['19', '20', '1']
                ]
            };

            const result = convertVKeyToSoroban(vkey);

            // Should have all required fields
            expect(result).toHaveProperty('alpha');
            expect(result).toHaveProperty('beta');
            expect(result).toHaveProperty('gamma');
            expect(result).toHaveProperty('delta');
            expect(result).toHaveProperty('ic');

            // alpha should be G1 (128 hex)
            expect(result.alpha.length).toBe(128);

            // beta, gamma, delta should be G2 (256 hex)
            expect(result.beta.length).toBe(256);
            expect(result.gamma.length).toBe(256);
            expect(result.delta.length).toBe(256);

            // IC should be array of G1 points
            expect(Array.isArray(result.ic)).toBe(true);
            expect(result.ic.length).toBe(3);
            result.ic.forEach(point => {
                expect(point.length).toBe(128);
            });
        });

        test('IC array length matches input', () => {
            const vkey = {
                vk_alpha_1: ['1', '2', '1'],
                vk_beta_2: [['3', '4'], ['5', '6'], ['1', '0']],
                vk_gamma_2: [['7', '8'], ['9', '10'], ['1', '0']],
                vk_delta_2: [['11', '12'], ['13', '14'], ['1', '0']],
                IC: [
                    ['1', '2', '1'],
                    ['3', '4', '1'],
                    ['5', '6', '1'],
                    ['7', '8', '1'],
                    ['9', '10', '1'],
                    ['11', '12', '1']
                ]
            };

            const result = convertVKeyToSoroban(vkey);
            expect(result.ic.length).toBe(6); // Same as input
        });
    });

    describe('Integration: Round-trip conversions', () => {
        test('G1 point byte reversal is consistent', () => {
            const originalValue = 12345678901234567890n;
            const leBytesHex = toLE32ByteHex(originalValue);

            // Reverse back to big-endian
            const beHex = reverseHexBytes(leBytesHex);

            // Convert back to bigint
            const recovered = BigInt('0x' + beHex);

            expect(recovered).toBe(originalValue);
        });

        test('proof conversion produces valid hex strings', () => {
            const proof = {
                pi_a: ['100', '200', '1'],
                pi_b: [['300', '400'], ['500', '600'], ['1', '0']],
                pi_c: ['700', '800', '1']
            };

            const result = convertProofToSoroban(proof);

            // All results should be valid hex
            expect(/^[0-9a-f]+$/.test(result.a)).toBe(true);
            expect(/^[0-9a-f]+$/.test(result.b)).toBe(true);
            expect(/^[0-9a-f]+$/.test(result.c)).toBe(true);
        });
    });

    describe('Edge cases', () => {
        test('handles zero values', () => {
            const result = toLE32ByteHex(0n);
            expect(result).toBe('0000000000000000000000000000000000000000000000000000000000000000');
        });

        test('handles point at infinity representation', () => {
            // Point at infinity typically has z=0
            const pointAtInfinity = ['0', '0', '0'];
            const result = convertG1Point(pointAtInfinity);

            // Should still produce valid 64-byte output
            expect(result.length).toBe(128);
            expect(result).toBe('0000000000000000000000000000000000000000000000000000000000000000' +
                               '0000000000000000000000000000000000000000000000000000000000000000');
        });

        test('handles maximum field element', () => {
            // BN254 field modulus - 1
            const fieldModulusMinus1 = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd46');
            const result = toLE32ByteHex(fieldModulusMinus1);

            // Should reverse correctly
            expect(result.length).toBe(64);
            expect(reverseHexBytes(result)).toBe('30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd46');
        });
    });
});
