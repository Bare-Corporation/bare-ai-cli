# External operational tooling

Operational and deployment tooling for this project lives **outside this repository**.

- This repository owns the files it tracks. Nothing outside it should need to modify them, and nothing
  inside it should overwrite a tracked file from a copy kept elsewhere.
- A copy of external operational tooling found inside this tree is a **finding**, not a convenience.
  Remove it and report it.
- Before changing how any file in this repository is produced or consumed, check which entry point
  actually reads it. A file can be assembled correctly and still never reach the consumer.
