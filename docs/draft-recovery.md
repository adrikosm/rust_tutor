# Browser draft recovery

Practice reasoning text is cached in `localStorage` under a versioned exercise key and expires seven days after its latest edit. Empty, expired, or malformed entries are removed. This cache is disposable recovery state only: it is never read as an attempt, event, artifact, evidence, mastery, or review record.

SQLite remains canonical. A draft becomes learner evidence only through a future explicit submission endpoint that appends an attempt event. Clearing site data may remove drafts without changing canonical progress.
