// Package domain is the vocabulary the domain packages share: the errors
// they return, how they store times, and the helpers their stores use. It
// knows nothing about Songs, Folders, Tags, Beats or Backups.
package domain

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Kind is what sort of refusal an Error is.
type Kind int

const (
	// KindInvalid is a request that can't be carried out as asked.
	KindInvalid Kind = iota + 1
	// KindConflict is an operation the current state doesn't allow.
	KindConflict
	// KindNotFound is something asked for that doesn't exist.
	KindNotFound
)

// Error is an operation the domain refused. Its message is safe to show the
// user.
type Error struct {
	Kind Kind
	Msg  string
	// Code, when set, tells one refusal apart from others of its Kind, so the
	// client can act on it, e.g. "stale" for a change to an out-of-date Song.
	Code string
	// Details, when set, are what the client needs to explain the refusal,
	// e.g. the Songs using a Beat. They're sent beside the message and the
	// code, so neither "error" nor "code" is a key of theirs.
	Details map[string]any
}

// Error is the message.
func (e *Error) Error() string { return e.Msg }

// Invalid is a request that can't be carried out as asked.
func Invalid(msg string) error { return &Error{Kind: KindInvalid, Msg: msg} }

// Conflict is an operation the current state doesn't allow.
func Conflict(msg string) error { return &Error{Kind: KindConflict, Msg: msg} }

// CodedConflict is a Conflict the client tells apart by its code, with the
// details it needs, if any.
func CodedConflict(code, msg string, details map[string]any) error {
	return &Error{Kind: KindConflict, Msg: msg, Code: code, Details: details}
}

// ErrNotFound means something asked for doesn't exist.
var ErrNotFound error = &Error{Kind: KindNotFound, Msg: "not found"}

// TimeFormat is how times are stored: it keeps sub-second precision and
// sorts correctly as text.
const TimeFormat = "2006-01-02T15:04:05.000000000Z"

// ParseTime reads a time stored in TimeFormat.
func ParseTime(s string) (time.Time, error) {
	t, err := time.Parse(TimeFormat, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("parsing stored time %q: %w", s, err)
	}
	return t, nil
}

// ExpectOneRow turns a write that matched no row into ErrNotFound.
func ExpectOneRow(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// Queryer is what both *sql.DB and *sql.Tx offer for reading.
type Queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Change is one field of a partial update. It is Set only when the field was
// sent; a JSON null sets it to the zero value, which clears optional fields.
type Change[T any] struct {
	Set   bool
	Value T
}

// UnmarshalJSON marks the field Set, as it was sent, and reads its value.
func (c *Change[T]) UnmarshalJSON(b []byte) error {
	c.Set = true
	return json.Unmarshal(b, &c.Value)
}
