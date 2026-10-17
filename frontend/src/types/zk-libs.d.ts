// Ambient module declarations for zk libraries that ship without TypeScript types.
// snarkjs and circomlibjs are used only via dynamic import in zkPassport.ts.

declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
    ): Promise<{ proof: Record<string, unknown>; publicSignals: string[] }>;
    verify(
      vkey: Record<string, unknown>,
      publicSignals: string[],
      proof: Record<string, unknown>,
    ): Promise<boolean>;
  };
}

declare module "circomlibjs" {
  export function buildPoseidon(): Promise<{
    (inputs: (bigint | string | number)[]): unknown;
    F: { toObject(x: unknown): bigint };
  }>;
}
