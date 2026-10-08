package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/xKirtle/bandmate/internal/domain"
)

// TestWriteDomainError pins the reply each kind of domain error gets.
func TestWriteDomainError(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		body   map[string]any
		logged bool
	}{
		{
			name:   "invalid",
			err:    domain.Invalid("title is required"),
			status: http.StatusBadRequest,
			body:   map[string]any{"error": "title is required"},
		},
		{
			name:   "conflict",
			err:    domain.Conflict("there's already a Tag called “Demos”"),
			status: http.StatusConflict,
			body:   map[string]any{"error": "there's already a Tag called “Demos”"},
		},
		{
			name:   "conflict with a code",
			err:    domain.CodedConflict("stale", "this Song changed elsewhere", nil),
			status: http.StatusConflict,
			body:   map[string]any{"error": "this Song changed elsewhere", "code": "stale"},
		},
		{
			name: "conflict with a code and details",
			err: domain.CodedConflict("in_use", "Songs use this Beat",
				map[string]any{"songs": []map[string]any{{"id": 1, "title": "Mine"}}}),
			status: http.StatusConflict,
			body: map[string]any{
				"error": "Songs use this Beat",
				"code":  "in_use",
				"songs": []any{map[string]any{"id": float64(1), "title": "Mine"}},
			},
		},
		{
			name:   "not found",
			err:    domain.ErrNotFound,
			status: http.StatusNotFound,
			body:   map[string]any{"error": "not found"},
		},
		{
			name:   "wrapped",
			err:    fmt.Errorf("renaming: %w", domain.Invalid("name is required")),
			status: http.StatusBadRequest,
			body:   map[string]any{"error": "name is required"},
		},
		{
			name:   "anything else",
			err:    errors.New("disk on fire"),
			status: http.StatusInternalServerError,
			body:   map[string]any{"error": "something went wrong"},
			logged: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			was := log.Writer()
			log.SetOutput(&logs)
			t.Cleanup(func() { log.SetOutput(was) })

			rec := httptest.NewRecorder()
			writeDomainError(rec, tt.err)

			if rec.Code != tt.status {
				t.Errorf("status = %d, want %d", rec.Code, tt.status)
			}
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("reading body %q: %v", rec.Body, err)
			}
			if !reflect.DeepEqual(body, tt.body) {
				t.Errorf("body = %v, want %v", body, tt.body)
			}
			if got := strings.Contains(logs.String(), "disk on fire"); got != tt.logged {
				t.Errorf("logged = %v, want %v (log: %q)", got, tt.logged, logs.String())
			}
		})
	}
}
