package audio

import (
	"errors"
	"log"
)

// FileChanges collects the changes to files that a transaction implies:
// received files to keep under an id, files to link and files to remove.
// None is made until the transaction commits, so files on disk follow the
// database: a transaction that rolls back, or fails to commit, changes no
// file, leaving the files received to be discarded. Its zero value is ready
// to use.
type FileChanges struct {
	changes []fileChange
}

// fileChange is one change to make once committed. A failure is logged
// rather than returned if failureLogged, for a change whose failure only
// leaves a file taking space.
type fileChange struct {
	apply         func() error
	failureLogged bool
}

// Keep has the received file kept under id once committed, replacing any
// file already there.
func (c *FileChanges) Keep(file *Received, id int64) {
	c.changes = append(c.changes, fileChange{apply: func() error { return file.Keep(id) }})
}

// Link has the file in files under from stored under to as well once
// committed, as Files.Link does.
func (c *FileChanges) Link(files *Files, from, to int64) {
	c.changes = append(c.changes, fileChange{apply: func() error { return files.Link(from, to) }})
}

// Remove has the file in files under id removed once committed.
func (c *FileChanges) Remove(files *Files, id int64) {
	c.changes = append(c.changes, fileChange{apply: func() error { return files.Remove(id) }, failureLogged: true})
}

// Commit runs commit, the transaction's, then makes every change, in the
// order they were asked for. If commit fails, it makes none. A file that
// can't be kept or linked once committed is an error, though what was
// committed stays so: a rename or a link within one directory failing is
// rare enough to leave its row without the file. A file that can't be
// removed only takes space, so that's logged.
func (c *FileChanges) Commit(commit func() error) error {
	if err := commit(); err != nil {
		return err
	}
	var errs []error
	for _, change := range c.changes {
		err := change.apply()
		switch {
		case err == nil:
		case change.failureLogged:
			log.Print(err)
		default:
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
