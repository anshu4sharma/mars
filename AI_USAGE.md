# AI usage

**DeepSeek coding assistant** — drafted the document, generated the Mermaid diagram, checked the rate-limit arithmetic and pressure-tested the concurrency design. Every decision was reviewed and is defensible on the call.

What I did not delegate: the choice of Postgres row locking over Redis-as-truth, the Nykaa 60-second limitation being stated rather than hidden, and the at-least-once-plus-reconciliation framing for the ERP.
