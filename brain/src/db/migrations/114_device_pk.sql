-- Device ed25519 public key (limited access key on the owner account, CLAUDE.md 7.2). Sent by the device in /devices/hello.
ALTER TABLE device ADD COLUMN device_pk TEXT;
