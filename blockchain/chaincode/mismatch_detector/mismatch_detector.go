package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// MismatchDetector maintains its own IMEI hash registry.
// On first CheckIMEI call for a user: stores the hash as baseline (self-register).
// On subsequent calls: compares current hash against stored baseline.
// Mismatch → emits SIM_SWAP_DETECTED event and returns HARD_BLOCK.
type MismatchDetector struct {
	contractapi.Contract
}

// IMEIBaseline is the stored baseline IMEI hash for a user.
//
// userHash MUST be HMAC-SHA-256(bank_id, customer_id, server_secret)
// (a keyed HMAC with a server-side secret), NOT unsalted SHA-256 —
// the chaincode cannot enforce the salt, but callers MUST compute it
// that way off-chain. Unsalted SHA-256 is re-identifiable.
type IMEIBaseline struct {
	UserHash     string `json:"userHash"`
	IMEIHash     string `json:"imeiHash"`
	RegisteredAt string `json:"registeredAt"`
	Owner        string `json:"owner"` // caller identity (GetID()) that registered this baseline
}

type CheckResult struct {
	UserHash   string `json:"userHash"`
	Matched    bool   `json:"matched"`
	Decision   string `json:"decision"` // "APPROVE" | "HARD_BLOCK"
	DetectedAt string `json:"detectedAt"`
	IsNewUser  bool   `json:"isNewUser"`
}

var hashRe = regexp.MustCompile(`^[0-9a-fA-F]+$`)

// validateHashes rejects empty strings, over-long strings (>128 chars),
// and any non-hex character. Hashes/HMACs are hex digests; we never
// accept arbitrary strings as Fabric state keys.
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

// CheckIMEI compares currentIMEIHash against the stored baseline for userHash.
// First call for a user: stores the hash as baseline (bound to the caller) and
// returns APPROVE. Subsequent calls: APPROVE if hash matches, HARD_BLOCK if
// mismatch (SIM swap). The self-register path is guarded: only the first caller
// wins; an existing baseline is never silently overwritten by a different caller.
func (m *MismatchDetector) CheckIMEI(
	ctx contractapi.TransactionContextInterface,
	userHash, currentIMEIHash string,
) (*CheckResult, error) {
	if err := validateHashes(userHash, currentIMEIHash); err != nil {
		return nil, fmt.Errorf("invalid input: %w", err)
	}

	caller, err := callerID(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC().Format(time.RFC3339)

	result := &CheckResult{
		UserHash:   userHash,
		DetectedAt: now,
	}

	data, err := ctx.GetStub().GetState(userHash)
	if err != nil {
		return nil, fmt.Errorf("failed to read state: %w", err)
	}

	if data == nil {
		// First login — register this IMEI hash as the baseline, bound to the caller.
		baseline := IMEIBaseline{
			UserHash:     userHash,
			IMEIHash:     currentIMEIHash,
			RegisteredAt: now,
			Owner:        caller,
		}
		encoded, err := json.Marshal(baseline)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal baseline: %w", err)
		}
		if err := ctx.GetStub().PutState(userHash, encoded); err != nil {
			return nil, fmt.Errorf("failed to write baseline: %w", err)
		}
		result.Matched = true
		result.Decision = "APPROVE"
		result.IsNewUser = true
		return result, nil
	}

	var baseline IMEIBaseline
	if err := json.Unmarshal(data, &baseline); err != nil {
		return nil, fmt.Errorf("failed to unmarshal baseline: %w", err)
	}

	result.Matched = baseline.IMEIHash == currentIMEIHash
	if result.Matched {
		result.Decision = "APPROVE"
	} else {
		result.Decision = "HARD_BLOCK"

		// Emit SIM_SWAP_DETECTED event for downstream listeners
		eventPayload, _ := json.Marshal(map[string]string{
			"userHash":   userHash,
			"event":      "SIM_SWAP_DETECTED",
			"detectedAt": now,
		})
		_ = ctx.GetStub().SetEvent("SIM_SWAP_DETECTED", eventPayload)
	}

	return result, nil
}

// QueryCheckIMEI is a read-only equivalent of CheckIMEI — no state writes.
// Returns APPROVE or HARD_BLOCK by comparing currentIMEIHash against the stored baseline.
// For new users (no baseline yet), returns APPROVE with IsNewUser=true.
// Use this for the real-time login fast path (<80ms via peer chaincode query).
func (m *MismatchDetector) QueryCheckIMEI(
	ctx contractapi.TransactionContextInterface,
	userHash, currentIMEIHash string,
) (*CheckResult, error) {
	if err := validateHashes(userHash, currentIMEIHash); err != nil {
		return nil, fmt.Errorf("invalid input: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)

	result := &CheckResult{
		UserHash:   userHash,
		DetectedAt: now,
	}

	data, err := ctx.GetStub().GetState(userHash)
	if err != nil {
		return nil, fmt.Errorf("failed to read state: %w", err)
	}

	if data == nil {
		// No baseline registered yet — treat as new user, approve
		result.Matched = true
		result.Decision = "APPROVE"
		result.IsNewUser = true
		return result, nil
	}

	var baseline IMEIBaseline
	if err := json.Unmarshal(data, &baseline); err != nil {
		return nil, fmt.Errorf("failed to unmarshal baseline: %w", err)
	}

	result.Matched = baseline.IMEIHash == currentIMEIHash
	if result.Matched {
		result.Decision = "APPROVE"
	} else {
		result.Decision = "HARD_BLOCK"
	}
	return result, nil
}

// RegisterIMEI explicitly sets a baseline IMEI hash (useful for pre-staging demo).
//
// First-caller-wins: if a baseline already exists for userHash, the overwrite
// is rejected UNLESS the caller's GetID() matches the stored Owner (the
// original enrollee / admin). Only first-time registration is otherwise allowed.
func (m *MismatchDetector) RegisterIMEI(
	ctx contractapi.TransactionContextInterface,
	userHash, imeiHash string,
) error {
	if err := validateHashes(userHash, imeiHash); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}

	caller, err := callerID(ctx)
	if err != nil {
		return err
	}

	existing, err := ctx.GetStub().GetState(userHash)
	if err != nil {
		return fmt.Errorf("failed to read state: %w", err)
	}
	if existing != nil {
		var prev IMEIBaseline
		if err := json.Unmarshal(existing, &prev); err != nil {
			return fmt.Errorf("failed to unmarshal existing baseline: %w", err)
		}
		if prev.Owner != caller {
			return fmt.Errorf("baseline already registered for user %s by a different owner", userHash)
		}
		// Same owner re-registering: allow overwrite (admin reset path).
	}

	baseline := IMEIBaseline{
		UserHash:     userHash,
		IMEIHash:     imeiHash,
		RegisteredAt: time.Now().UTC().Format(time.RFC3339),
		Owner:        caller,
	}
	encoded, err := json.Marshal(baseline)
	if err != nil {
		return fmt.Errorf("failed to marshal baseline: %w", err)
	}
	return ctx.GetStub().PutState(userHash, encoded)
}

func main() {
	chaincode, err := contractapi.NewChaincode(&MismatchDetector{})
	if err != nil {
		panic(fmt.Sprintf("Error creating MismatchDetector chaincode: %v", err))
	}
	if err := chaincode.Start(); err != nil {
		panic(fmt.Sprintf("Error starting MismatchDetector chaincode: %v", err))
	}
}
