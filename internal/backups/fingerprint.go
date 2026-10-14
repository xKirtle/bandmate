package backups

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strconv"

	"github.com/xKirtle/bandmate/internal/db"
	"github.com/xKirtle/bandmate/internal/songfiles"
)

// fingerprint hashes what a Backup of Everything would hold now: the rows
// it would copy, picked as copyContents picks them, and each file those rows
// use, by its path, size and when it was last written, as a file can be
// replaced in place (a Beat's audio, a Cover). Rows kept only for undo
// aren't picked, so sweeping them changes nothing. Equal fingerprints mean
// a Backup of Everything would hold the same; no audio is read.
func (s *Store) fingerprint(ctx context.Context) (string, error) {
	mem, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return "", err
	}
	defer mem.Close()
	conn, err := mem.Conn(ctx)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `PRAGMA busy_timeout = 5000`); err != nil {
		return "", err
	}
	if _, err := conn.ExecContext(ctx, `ATTACH DATABASE ? AS src`, filepath.Join(s.dataDir, db.FileName)); err != nil {
		return "", fmt.Errorf("reading the database: %w", err)
	}
	// One snapshot of the live database for every row.
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	songIDs, err := queryIDs(ctx, tx, `SELECT id FROM src.songs WHERE NOT demo ORDER BY id`)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	files := map[string][]int64{}
	for _, id := range songIDs {
		fmt.Fprintf(h, "song %d\n", id)
		if err := hashRows(ctx, tx, h, files, songTables, id); err != nil {
			return "", err
		}
	}
	h.Write([]byte("beat library\n"))
	if err := hashRows(ctx, tx, h, files, beatLibraryTables); err != nil {
		return "", err
	}
	if err := tx.Rollback(); err != nil {
		return "", err
	}
	if err := s.hashFiles(h, files); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// hashRows writes the rows tables pick, given args, to h, each table's in
// a fixed order, and adds to files, by table, the ids of the rows picked
// from a table some kind of file is kept under.
func hashRows(ctx context.Context, tx *sql.Tx, h io.Writer, files map[string][]int64,
	tables []songTable, args ...any) error {
	for _, t := range tables {
		rows, err := tx.QueryContext(ctx, fmt.Sprintf(`SELECT * FROM src.%s WHERE %s`, t.name, t.where), args...)
		if err != nil {
			return fmt.Errorf("reading %s: %w", t.name, err)
		}
		encoded, ids, err := encodeRows(rows, keepsFiles(t.name))
		if err != nil {
			return fmt.Errorf("reading %s: %w", t.name, err)
		}
		slices.SortFunc(encoded, bytes.Compare)
		fmt.Fprintf(h, "%s %d\n", t.name, len(encoded))
		for _, row := range encoded {
			h.Write(row)
		}
		files[t.name] = append(files[t.name], ids...)
	}
	return nil
}

// keepsFiles tells whether some kind of file is kept under table's rows.
func keepsFiles(table string) bool {
	return slices.ContainsFunc(songfiles.Kinds, func(k songfiles.Kind) bool { return k.Table == table })
}

// encodeRows encodes each row unambiguously, each value with its type and
// length, and, if withIDs, lists the rows' ids.
func encodeRows(rows *sql.Rows, withIDs bool) (encoded [][]byte, ids []int64, err error) {
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	idAt := slices.Index(columns, "id")
	if withIDs && idAt < 0 {
		return nil, nil, errors.New("rows with files have no id")
	}
	values := make([]any, len(columns))
	pointers := make([]any, len(columns))
	for i := range values {
		pointers[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(pointers...); err != nil {
			return nil, nil, err
		}
		var row []byte
		for _, v := range values {
			row = appendValue(row, v)
		}
		encoded = append(encoded, row)
		if withIDs {
			id, ok := values[idAt].(int64)
			if !ok {
				return nil, nil, fmt.Errorf("a row's id is %T", values[idAt])
			}
			ids = append(ids, id)
		}
	}
	return encoded, ids, rows.Err()
}

// appendValue appends a value read from SQLite, tagged with its type, and
// with its length if it's text or a blob.
func appendValue(b []byte, v any) []byte {
	switch v := v.(type) {
	case nil:
		return append(b, 'n')
	case int64:
		return binary.BigEndian.AppendUint64(append(b, 'i'), uint64(v))
	case float64:
		return binary.BigEndian.AppendUint64(append(b, 'f'), math.Float64bits(v))
	case string:
		return append(binary.BigEndian.AppendUint64(append(b, 's'), uint64(len(v))), v...)
	case []byte:
		return append(binary.BigEndian.AppendUint64(append(b, 'b'), uint64(len(v))), v...)
	default:
		s := fmt.Sprint(v)
		return append(binary.BigEndian.AppendUint64(append(b, 'o'), uint64(len(s))), s...)
	}
}

// hashFiles writes to h each file the rows picked use, by kind and id, with
// its size and when it was last written, or that it's missing.
func (s *Store) hashFiles(h io.Writer, files map[string][]int64) error {
	for _, k := range songfiles.Kinds {
		ids := slices.Clone(files[k.Table])
		slices.Sort(ids)
		for _, id := range slices.Compact(ids) {
			name := strconv.FormatInt(id, 10)
			info, err := os.Stat(filepath.Join(s.dataDir, k.Dir, name))
			switch {
			case errors.Is(err, fs.ErrNotExist):
				fmt.Fprintf(h, "%s/%s missing\n", k.Dir, name)
			case err != nil:
				return err
			default:
				fmt.Fprintf(h, "%s/%s %d %d\n", k.Dir, name, info.Size(), info.ModTime().UnixNano())
			}
		}
	}
	return nil
}
