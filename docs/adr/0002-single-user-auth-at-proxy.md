# Single user, authentication handled by the reverse proxy

Bandmate has no users, accounts or login. It runs behind a reverse proxy that handles HTTPS and authentication, and trusts every request that reaches it. It is a personal tool, so adding multi-user support in advance (not even an owner field on Songs) was rejected as scope creep. If Bandmate is ever shared, accounts and data ownership get added then.
