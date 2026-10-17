declare module "mlkem" {
  export class MlKem768 {
    generateKeyPair(): Promise<[Uint8Array, Uint8Array]>;
    encap(pk: Uint8Array): Promise<[Uint8Array, Uint8Array]>;
    decap(ct: Uint8Array, sk: Uint8Array): Promise<Uint8Array>;
  }
}

declare module "jsqr" {
  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: string }
  ): { data: string } | null;
}

declare module "@vapi-ai/web";

