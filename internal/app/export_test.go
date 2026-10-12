package app

import "context"

// CheckBackupSchedule runs the check for a Scheduled Backup that's made
// hourly, at start-up and when the schedule is turned on, so a test needn't
// wait an hour for one. It returns once the check is done.
func (a *App) CheckBackupSchedule() {
	a.backups.CheckSchedule(context.Background())
}
