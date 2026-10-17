pragma circom 2.1.0;

include "poseidon.circom";
include "comparators.circom";

// Proves, WITHOUT revealing the private inputs, that:
//   1. the prover knows (featureCommit, imeiSecret) whose Poseidon hash equals
//      the enrolled public baseline  -> device/identity binding
//   2. the behavioral riskScore is <= the public maxRiskThreshold
// Public : maxRiskThreshold, expectedBaselineHash
// Private: riskScore, featureCommit, imeiSecret
template BehavioralPassport() {
    signal input riskScore;            // private
    signal input featureCommit;        // private
    signal input imeiSecret;           // private
    signal input maxRiskThreshold;     // public
    signal input expectedBaselineHash; // public

    // 1. Identity binding via Poseidon(2)
    component h = Poseidon(2);
    h.inputs[0] <== featureCommit;
    h.inputs[1] <== imeiSecret;
    h.out === expectedBaselineHash;

    // 2. Risk threshold (values assumed < 2^16)
    component le = LessEqThan(16);
    le.in[0] <== riskScore;
    le.in[1] <== maxRiskThreshold;
    le.out === 1;
}

component main {public [maxRiskThreshold, expectedBaselineHash]} = BehavioralPassport();
