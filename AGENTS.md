# AGENTS.md

## Core Guiding Principles

1. **Clarity & Understandability First**
   - All code, architecture, and configuration must be clear, readable, and easy for me to understand and explain in an interview.
   - Avoid overly clever, obfuscated, or excessively complex abstractions when a clean, direct solution works better.

2. **Comprehensive & Meaningful Comments**
   - Document the "why", not just the "what".
   - Every function, service, complex query, and business rule (especially sequence lifecycle transitions, rate limits, and idempotency guarantees) must include descriptive docstrings and inline explanatory comments.
   - Provide clear type definitions and interfaces for every module.

3. **Production-Ready Coding Standards**
   - Strict TypeScript types — avoid `any`.
   - Explicit error handling with meaningful error messages.
   - Maintain idempotency: repeated executions must never cause duplicate operations or data corruption.
