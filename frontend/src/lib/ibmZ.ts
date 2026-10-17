export type IbmZCapability = {
  id: string;
  name: string;
  component: string;
  benefit: string;
  status: "target" | "live";
};

export const IBM_Z_CAPABILITIES: IbmZCapability[] = [
  {
    id: "telum",
    name: "Telum on-chip AI accelerator",
    component: "XGBoost, Siamese, CNN-LSTM, Isolation Forest scoring",
    benefit:
      "Inference inside the payment window via ONNX / Snap ML, with no data leaving the system.",
    status: "target",
  },
  {
    id: "crypto-express",
    name: "Crypto Express HSM",
    component: "HMAC salts, JWT and ML-DSA / ML-KEM keys",
    benefit: "Keys never sit in application memory; verdict signatures are quantum-safe.",
    status: "target",
  },
  {
    id: "secure-execution",
    name: "Secure Execution for Linux",
    component: "Decision engine, ML service, AI investigator",
    benefit: "Models and in-flight behavioural data are protected from privileged-admin and host access.",
    status: "target",
  },
  {
    id: "fabric-s390x",
    name: "Hyperledger Fabric on s390x",
    component: "Mule flags, IMEI hash registry, SIM-swap check",
    benefit: "Bank-controlled consortium ledger. Hashes only, no PII.",
    status: "target",
  },
  {
    id: "llama-linuxone",
    name: "Self-hosted LLaMA 3.3",
    component: "FIU case-report drafting",
    benefit: "Case data never goes to a third-party API.",
    status: "target",
  },
  {
    id: "pervasive-encryption",
    name: "Pervasive / protected-key encryption",
    component: "PostgreSQL, Redis, logs",
    benefit: "Encrypted at rest by default; supports DPDP data localisation.",
    status: "target",
  },
];

export type CryptoAgilityItem = {
  id: string;
  asset: string;
  endpoint: string;
  algorithm: string;
  purpose: string;
  quantum_safe: "yes" | "partial" | "no";
  key_custody: string;
  hsm_target: string | null;
  note?: string;
};

export const IBM_Z_ARCHITECTURE = "s390x";

export function isLinuxOneHost(): boolean {
  // Design-target: real detection would inspect navigator.userAgentData or a
  // server-provided attestation. On the browser we can never know for sure.
  return false;
}

export function telumAvailable(): boolean {
  return false;
}

export function cryptoExpressAvailable(): boolean {
  return false;
}

export function secureExecutionAvailable(): boolean {
  return false;
}

export function describeTrustBoundary(): string {
  return (
    "Citadel's IBM Z deployment targets LinuxONE s390x with Telum on-chip AI, " +
    "Crypto Express HSM keys, Secure Execution guests, Hyperledger Fabric on s390x, " +
    "self-hosted LLaMA 3.3 and pervasive encryption. This browser build runs on " +
    "commodity hardware; the IBM Z features are deployment targets, not active here."
  );
}
