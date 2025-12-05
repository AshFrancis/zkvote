declare module 'circomlibjs' {
  /**
   * Field element type used by Poseidon
   */
  interface FieldElement {
    toString(): string;
    toBigInt(): bigint;
  }

  /**
   * Field operations interface
   */
  interface PoseidonField {
    e(value: bigint | number | string): FieldElement;
    toObject(element: FieldElement): bigint;
  }

  /**
   * Poseidon hash function instance
   */
  interface PoseidonHasher {
    (inputs: FieldElement[]): FieldElement;
    F: PoseidonField;
  }

  /**
   * Build a Poseidon hasher instance
   */
  export function buildPoseidon(): Promise<PoseidonHasher>;

  /**
   * Synchronous Poseidon (if available)
   */
  export const poseidon: PoseidonHasher | undefined;

  const defaultExport: {
    buildPoseidon: typeof buildPoseidon;
    poseidon?: PoseidonHasher;
  };
  export default defaultExport;
}
