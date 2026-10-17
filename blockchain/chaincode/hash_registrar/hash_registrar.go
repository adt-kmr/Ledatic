package main

import (
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// HashRegistrar stores HMAC-SHA-256 hashes of device identifiers.
// No raw PII is ever stored on-chain.
type HashRegistrar struct {
	contractapi.Contract
}

// IMEIRecord is the on-chain record for a user's enrolled device.
//
// userHash MUST be computed off-chain as
//
//	HMAC-SHA-256(bank_id, customer_id, server_secret)
//
// (i.e. a keyed HMAC using a server-side secret, NOT a bare hash of
// bank_id+customer_id). Unsalted SHA-256 is NOT acceptable: it is
// deterministic and re-identifiable via dictionary/rainbow attacks
// against the small bank_id × customer_id input space. The chaincode
// cannot enforce the salt itself, so callers MUST compute userHash
// with a server-side HMAC key before invoking RegisterIMEI.
//
// imeiHash is HMAC-SHA-256(IMEI, salt).
//
// BankID is intentionally NOT stored: storing a plaintext bank
// identifier on-chain would leak which bank owns a customer. The
// bank identity is folded into the userHash HMAC instead.
type IMEIRecord struct {
	UserHash     string `json:"userHash"` // HMAC-SHA-256(bank_id, customer_id, server_secret) — NOT unsalted SHA-256
	IMEIHash     string `json:"imeiHash"` // HMAC-SHA-256(IMEI, salt)
	RegisteredAt string `json:"registeredAt"`
	Owner        string `json:"owner"` // caller identity (GetID()) that enrolled this record
}

var hashRe = regexp.MustCompile(`^[0-9a-fA-F]+$`)

// validateHashes rejects empty strings, over-long strings (>128 chars),
// and any non-hex character. Hashes/HMACs are hex-encoded digests; we
// never accept arbitrary strings as Fabric state keys.
func validateHashes(hashes ...string) error {
	const maxLen = 128
	for _, h := range hashes {
		if h == "" {
			return fmt.Errorf("hash must not be empty")
		}
		if len(h) > maxLen {
			return fmt.Errorf("hash too long (%d > %d): %s", len(h), maxLen, h[:16])
		}
		if !hashRe.MatchString(h) {
			return fmt.Errorf("hash contains non-hex characters: %s", h)
		}
	}
	return nil
}

// callerID returns the cert subject of the invoking identity.
// It errors if the client identity cannot be resolved — in which case
// the transaction MUST be aborted (no state mutation occurs).
func callerID(ctx contractapi.TransactionContextInterface) (string, error) {
	cid, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return "", fmt.Errorf("failed to resolve caller identity: %w", err)
	}
	if cid == "" {
		return "", fmt.Errorf("caller identity is empty")
	}
	return cid, nil
}

// RegisterIMEI stores a user's IMEI hash on first enrollment.
//
// First-caller-wins: if a record already exists for userHash, the
// overwrite is rejected. The caller's GetID() is recorded as the
// Owner so future (hypothetical) update/delete paths can enforce
// that only the original enrollee (or an admin) may mutate the
// record. There are no Update/Delete functions exposed today.
func (h *HashRegistrar) RegisterIMEI(
	ctx contractapi.TransactionContextInterface,
	userHash, imeiHash, timestamp string,
) error {
	if err := validateHashes(userHash, imeiHash); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}

	owner, err := callerID(ctx)
	if err != nil {
		return err
	}

	existing, err := ctx.GetStub().GetState(userHash)
	if err != nil {
		return fmt.Errorf("failed to read state: %w", err)
	}
	if existing != nil {
		return fmt.Errorf("IMEI already registered for user %s", userHash)
	}

	record := IMEIRecord{
		UserHash:     userHash,
		IMEIHash:     imeiHash,
		RegisteredAt: timestamp,
		Owner:        owner,
	}

	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("failed to marshal record: %w", err)
	}

	return ctx.GetStub().PutState(userHash, data)
}

// SecurityVerdictRecord is the on-chain anchor for an advanced-security
// HARD_BLOCK (deception trap, replay attack, invalid zk passport, ...).
//
// Only a digest of the verdict is stored — never raw telemetry, never PII —
// keeping the same privacy posture as IMEIRecord. The Dilithium-3 (ML-DSA-65)
// signature over that verdict is stored alongside it so the block is
// independently verifiable as post-quantum authentic after the fact.
type SecurityVerdictRecord struct {
	UserHash     string `json:"userHash"`     // salted HMAC identity, as for IMEIRecord
	VerdictHash  string `json:"verdictHash"`  // SHA-256 over the canonical verdict
	Decision     string `json:"decision"`     // HARD_BLOCK | STEP_UP
	RiskScore    string `json:"riskScore"`    // 0-1000, string for chaincode arg simplicity
	Trigger      string `json:"trigger"`      // which module fired
	Signature    string `json:"signature"`    // base64 Dilithium-3 signature
	Algorithm    string `json:"algorithm"`    // e.g. "Dilithium-3"
	RegisteredAt string `json:"registeredAt"`
	Owner        string `json:"owner"`
}

// securityKey namespaces verdict anchors so they can never collide with the
// IMEI records that share this chaincode's state space (an IMEI record is
// keyed by the bare userHash).
func securityKey(verdictHash string) string {
	return "SECVERDICT_" + verdictHash
}

// RegisterSecurityVerdict anchors an advanced-security block on-chain.
//
// Keyed by the verdict digest rather than the user, so a user may accumulate
// many verdicts over time (unlike RegisterIMEI, which is first-caller-wins on
// a single baseline). Re-anchoring the identical verdict is idempotent: the
// same digest yields the same key and the existing record is left untouched
// rather than erroring, because a retry after a network blip must not fail.
func (h *HashRegistrar) RegisterSecurityVerdict(
	ctx contractapi.TransactionContextInterface,
	userHash, verdictHash, decision, riskScore, trigger, signature, algorithm, timestamp string,
) error {
	// userHash and verdictHash are hex digests; the remaining fields are
	// free-form metadata and are length-capped rather than hex-validated.
	if err := validateHashes(userHash, verdictHash); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}
	if len(decision) > 32 || len(riskScore) > 8 || len(trigger) > 64 || len(algorithm) > 32 {
		return fmt.Errorf("metadata field exceeds maximum length")
	}
	// Dilithium-3 signatures are ~3.3 KB base64; cap generously but finitely.
	if len(signature) > 8192 {
		return fmt.Errorf("signature too long (%d)", len(signature))
	}

	owner, err := callerID(ctx)
	if err != nil {
		return err
	}

	key := securityKey(verdictHash)
	existing, err := ctx.GetStub().GetState(key)
	if err != nil {
		return fmt.Errorf("failed to read state: %w", err)
	}
	if existing != nil {
		return nil // idempotent re-anchor
	}

	record := SecurityVerdictRecord{
		UserHash:     userHash,
		VerdictHash:  verdictHash,
		Decision:     decision,
		RiskScore:    riskScore,
		Trigger:      trigger,
		Signature:    signature,
		Algorithm:    algorithm,
		RegisteredAt: timestamp,
		Owner:        owner,
	}

	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("failed to marshal record: %w", err)
	}

	return ctx.GetStub().PutState(key, data)
}

// GetSecurityVerdict returns a previously anchored security verdict.
func (h *HashRegistrar) GetSecurityVerdict(
	ctx contractapi.TransactionContextInterface,
	verdictHash string,
) (*SecurityVerdictRecord, error) {
	if err := validateHashes(verdictHash); err != nil {
		return nil, fmt.Errorf("invalid input: %w", err)
	}

	data, err := ctx.GetStub().GetState(securityKey(verdictHash))
	if err != nil {
		return nil, fmt.Errorf("failed to read state: %w", err)
	}
	if data == nil {
		return nil, fmt.Errorf("no security verdict found for %s", verdictHash)
	}

	var record SecurityVerdictRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, fmt.Errorf("failed to unmarshal record: %w", err)
	}

	return &record, nil
}

// GetIMEIRecord returns the stored IMEI record for a user.
func (h *HashRegistrar) GetIMEIRecord(
	ctx contractapi.TransactionContextInterface,
	userHash string,
) (*IMEIRecord, error) {
	if err := validateHashes(userHash); err != nil {
		return nil, fmt.Errorf("invalid input: %w", err)
	}

	data, err := ctx.GetStub().GetState(userHash)
	if err != nil {
		return nil, fmt.Errorf("failed to read state: %w", err)
	}
	if data == nil {
		return nil, fmt.Errorf("no record found for user %s", userHash)
	}

	var record IMEIRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, fmt.Errorf("failed to unmarshal record: %w", err)
	}

	return &record, nil
}

func main() {
	chaincode, err := contractapi.NewChaincode(&HashRegistrar{})
	if err != nil {
		panic(fmt.Sprintf("Error creating HashRegistrar chaincode: %v", err))
	}
	if err := chaincode.Start(); err != nil {
		panic(fmt.Sprintf("Error starting HashRegistrar chaincode: %v", err))
	}
}
