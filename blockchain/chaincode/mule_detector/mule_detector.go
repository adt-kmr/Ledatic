package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// MuleDetector flags accounts that receive an unusual number of transfers
// from previously flagged source accounts — detects money mule networks.
type MuleDetector struct {
	contractapi.Contract
}

// AccountRecord is the per-account mule-detection state.
//
// userHash MUST be HMAC-SHA-256(bank_id, customer_id, server_secret)
// (keyed HMAC with a server-side secret), NOT unsalted SHA-256. The
// chaincode cannot enforce the salt; callers MUST compute it off-chain.
//
// FlaggedSources maps a flagged sender's hash to the RFC3339 timestamp
// of its most recent in-window transfer to this account. It is a SET
// (a sender is counted once regardless of how many transfers it sends),
// and entries older than transferWindow are pruned on every write so
// only recent activity counts toward the threshold.
type AccountRecord struct {
	UserHash       string            `json:"userHash"`
	FlaggedSources map[string]string `json:"flaggedSources"` // senderHash -> lastSeen RFC3339
	IsFlagged      bool              `json:"isFlagged"`
	FlaggedAt      string            `json:"flaggedAt,omitempty"`
}

// muleThreshold is the number of DISTINCT flagged senders that must
// have transferred to a single account within transferWindow before
// that account is itself flagged as a mule.
const (
	muleThreshold  = 5
	transferWindow = 30 * 24 * time.Hour // 30 days
	adminAttribute = "admin"
)

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

// isAdmin returns true if the caller carries the "admin" attribute
// (set in their enrollment certificate as attr.Admin=true). This is
// the guard used for privileged operations such as UnflagAccount.
func isAdmin(ctx contractapi.TransactionContextInterface) (bool, error) {
	if _, err := callerID(ctx); err != nil {
		return false, err
	}
	val, found, err := ctx.GetClientIdentity().GetAttributeValue(adminAttribute)
	if err != nil {
		return false, fmt.Errorf("failed to read admin attribute: %w", err)
	}
	return found && val == "true", nil
}

// txTimestamp returns the trusted transaction timestamp from the
// fabric proposal header (ctx.GetStub().GetTxTimestamp()), formatted
// as RFC3339. This is NOT a client-supplied value.
func txTimestamp(ctx contractapi.TransactionContextInterface) (time.Time, string, error) {
	tsProto, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return time.Time{}, "", fmt.Errorf("failed to read tx timestamp: %w", err)
	}
	ts := time.Unix(tsProto.Seconds, int64(tsProto.Nanos)).UTC()
	return ts, ts.Format(time.RFC3339), nil
}

// pruneSources removes FlaggedSources entries whose lastSeen timestamp
// is older than the transfer window relative to `now`. This makes the
// mule count time-bounded: only senders with a transfer within the last
// transferWindow contribute to muleThreshold.
func pruneSources(sources map[string]string, now time.Time) {
	cutoff := now.Add(-transferWindow)
	for s, tsStr := range sources {
		ts, err := time.Parse(time.RFC3339, tsStr)
		if err != nil {
			// Unparseable entry: drop it so a corrupt timestamp cannot
			// pin a sender in the set forever.
			delete(sources, s)
			continue
		}
		if ts.Before(cutoff) {
			delete(sources, s)
		}
	}
}

// senderIsFlaggedOnChain queries the sender's AccountRecord on-chain and
// returns whether the sender account is currently flagged as a mule.
// The client-supplied senderIsFlagged value is deliberately NOT trusted.
func senderIsFlaggedOnChain(ctx contractapi.TransactionContextInterface, senderHash string) (bool, error) {
	data, err := ctx.GetStub().GetState(senderHash)
	if err != nil {
		return false, fmt.Errorf("failed to read sender state: %w", err)
	}
	if data == nil {
		return false, nil // sender has no on-chain record → not flagged
	}
	var sender AccountRecord
	if err := json.Unmarshal(data, &sender); err != nil {
		return false, fmt.Errorf("failed to unmarshal sender record: %w", err)
	}
	return sender.IsFlagged, nil
}

// RecordTransfer records an inbound transfer and checks for the mule pattern.
//
// The client-supplied senderIsFlagged parameter is IGNORED — it is kept in
// the signature for call-site compatibility but is NOT trusted. Whether the
// sender is flagged is verified by reading the sender's on-chain
// AccountRecord. A transfer from a sender with no record or a non-flagged
// sender is ignored (no state change).
//
// FlaggedSources is a deduplicated set keyed by senderHash: a single sender
// making many transfers counts once. Only transfers within transferWindow
// (30 days, measured by the trusted tx timestamp) count toward the
// muleThreshold.
func (md *MuleDetector) RecordTransfer(
	ctx contractapi.TransactionContextInterface,
	recipientHash, senderHash string,
	senderIsFlagged bool, //nolint:revive // kept for API compatibility; deliberately unused
	timestamp string,
) (*AccountRecord, error) {
	_ = senderIsFlagged // explicitly do not trust the client

	if err := validateHashes(recipientHash, senderHash); err != nil {
		return nil, fmt.Errorf("invalid input: %w", err)
	}
	if _, err := callerID(ctx); err != nil {
		return nil, err
	}

	nowTime, nowStr, err := txTimestamp(ctx)
	if err != nil {
		return nil, err
	}

	// Verify the sender's flagged status on-chain — do NOT trust the caller.
	senderFlagged, err := senderIsFlaggedOnChain(ctx, senderHash)
	if err != nil {
		return nil, err
	}
	if !senderFlagged {
		// Sender is not a flagged account: this transfer does not count
		// toward the mule pattern. Still persist (no-op write avoided) —
		// we simply return the recipient's current state unchanged.
		data, gerr := ctx.GetStub().GetState(recipientHash)
		if gerr != nil {
			return nil, fmt.Errorf("failed to read state: %w", gerr)
		}
		if data == nil {
			return &AccountRecord{UserHash: recipientHash}, nil
		}
		var rec AccountRecord
		if jerr := json.Unmarshal(data, &rec); jerr != nil {
			return nil, fmt.Errorf("failed to unmarshal: %w", jerr)
		}
		return &rec, nil
	}

	data, err := ctx.GetStub().GetState(recipientHash)
	if err != nil {
		return nil, fmt.Errorf("failed to read state: %w", err)
	}

	var record AccountRecord
	if data == nil {
		record = AccountRecord{
			UserHash:       recipientHash,
			FlaggedSources: map[string]string{},
		}
	} else {
		if err := json.Unmarshal(data, &record); err != nil {
			return nil, fmt.Errorf("failed to unmarshal: %w", err)
		}
		if record.FlaggedSources == nil {
			record.FlaggedSources = map[string]string{}
		}
	}

	// Drop senders whose last transfer is outside the rolling window.
	pruneSources(record.FlaggedSources, nowTime)

	// Dedup: setting the map key overwrites any prior entry, so a single
	// sender making N transfers counts exactly once.
	record.FlaggedSources[senderHash] = nowStr

	count := len(record.FlaggedSources)
	if count >= muleThreshold && !record.IsFlagged {
		record.IsFlagged = true
		record.FlaggedAt = nowStr

		eventPayload, _ := json.Marshal(map[string]string{
			"userHash":  recipientHash,
			"event":     "MULE_DETECTED",
			"count":     fmt.Sprintf("%d", count),
			"flaggedAt": nowStr,
		})
		_ = ctx.GetStub().SetEvent("MULE_DETECTED", eventPayload)
	}

	updated, err := json.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal: %w", err)
	}
	if err := ctx.GetStub().PutState(recipientHash, updated); err != nil {
		return nil, fmt.Errorf("failed to write state: %w", err)
	}

	return &record, nil
}

// IsAccountFlagged returns whether an account is flagged as a mule.
func (md *MuleDetector) IsAccountFlagged(
	ctx contractapi.TransactionContextInterface,
	userHash string,
) (bool, error) {
	if err := validateHashes(userHash); err != nil {
		return false, fmt.Errorf("invalid input: %w", err)
	}

	data, err := ctx.GetStub().GetState(userHash)
	if err != nil {
		return false, fmt.Errorf("failed to read state: %w", err)
	}
	if data == nil {
		return false, nil
	}

	var record AccountRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return false, fmt.Errorf("failed to unmarshal: %w", err)
	}

	return record.IsFlagged, nil
}

// GetAccountRecord returns the full mule-detection record for an account
// (read-only, for dashboards/auditing). FlaggedSources is returned as a
// sorted slice for deterministic output.
func (md *MuleDetector) GetAccountRecord(
	ctx contractapi.TransactionContextInterface,
	userHash string,
) (*AccountRecord, error) {
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

	var record AccountRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, fmt.Errorf("failed to unmarshal: %w", err)
	}
	return &record, nil
}

// UnflagAccount clears the IsFlagged flag on an account. This is an admin
// operation: the caller must carry the "admin" attribute (attr.Admin=true
// in their enrollment certificate). It also drops the FlaggedSources set so
// the account starts fresh. The original flagging event remains in ledger
// history (immutable) — this only resets the current world-state flag.
func (md *MuleDetector) UnflagAccount(
	ctx contractapi.TransactionContextInterface,
	userHash string,
) error {
	if err := validateHashes(userHash); err != nil {
		return fmt.Errorf("invalid input: %w", err)
	}

	admin, err := isAdmin(ctx)
	if err != nil {
		return err
	}
	if !admin {
		return fmt.Errorf("UnflagAccount requires the %q client attribute", adminAttribute)
	}

	data, err := ctx.GetStub().GetState(userHash)
	if err != nil {
		return fmt.Errorf("failed to read state: %w", err)
	}
	if data == nil {
		return fmt.Errorf("no record found for user %s", userHash)
	}

	var record AccountRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return fmt.Errorf("failed to unmarshal: %w", err)
	}

	record.IsFlagged = false
	record.FlaggedAt = ""
	record.FlaggedSources = map[string]string{}

	updated, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("failed to marshal: %w", err)
	}
	return ctx.GetStub().PutState(userHash, updated)
}

func main() {
	chaincode, err := contractapi.NewChaincode(&MuleDetector{})
	if err != nil {
		panic(fmt.Sprintf("Error creating MuleDetector chaincode: %v", err))
	}
	if err := chaincode.Start(); err != nil {
		panic(fmt.Sprintf("Error starting MuleDetector chaincode: %v", err))
	}
}
