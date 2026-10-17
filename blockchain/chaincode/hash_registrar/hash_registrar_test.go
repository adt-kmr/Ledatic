package main

import (
	"testing"
)

func TestValidateHashes(t *testing.T) {
	tests := []struct {
		name    string
		hashes  []string
		wantErr bool
	}{
		{"valid hex", []string{"abc123def456"}, false},
		{"empty string", []string{""}, true},
		{"non-hex chars", []string{"xyz123"}, true},
		{"too long", []string{string(make([]byte, 200))}, true},
		{"multiple valid", []string{"abc123", "def456"}, false},
		{"one invalid among valid", []string{"abc123", "xyz"}, true},
		{"uppercase hex", []string{"ABC123DEF456"}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateHashes(tt.hashes...)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateHashes() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestHashRe(t *testing.T) {
	validHashes := []string{"abc123", "ABC123", "0123456789abcdef", "FFFFFFFF"}
	for _, h := range validHashes {
		if !hashRe.MatchString(h) {
			t.Errorf("hashRe should match %q", h)
		}
	}

	invalidHashes := []string{"xyz", "abc def", "abc@123", ""}
	for _, h := range invalidHashes {
		if hashRe.MatchString(h) {
			t.Errorf("hashRe should NOT match %q", h)
		}
	}
}
