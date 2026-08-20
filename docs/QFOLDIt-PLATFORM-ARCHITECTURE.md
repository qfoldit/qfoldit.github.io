# qFoldIT Platform Architecture v1

qFoldIT is a scientific computing and interactive scientific-world platform. The platform combines scientific intelligence, mission orchestration, canonical scientific state and multiple runtime adapters.

## Architecture

```text
                         qFoldIT
                            |
          +-----------------+------------------+
          |                                    |
   Scientific Intelligence              Scientific Worlds
          |                                    |
     Agent / MCP Mesh                    World Runtime Mesh
          |                                    |
  +-------+--------+                 +---------+----------+
  |       |        |                 |         |          |
 Bio    Chem    Quantum            UEFN     Unity      UNIGINE
  |       |        |                 |         |          |
  +-------+--------+                 +----+----+----------+
          |                               |
          +-------- Scientific State -----+
                            |
                           UAG
                            |
                          CAMEO
                            |
                  Scientific Validation
                            |
                     OPENSTRUCTURE
                            |
                     Evidence / Audit
                            |
                  Mission / STATE layer
```

## Canonical layers

- **Enterprise Control:** `CORPORATE_APP`
- **Mission Orchestration:** `INDUSTRIAL-CAMEO`
- **Runtime Validation/Reconciliation:** `CAMEO-REALTIME-VALIDATION`
- **Scientific Validation:** `OPENSTRUCTURE` and other domain-specific validators
- **Scientific World Model:** `Scientific-Object-Schema`
- **World Assembly:** UAG
- **Runtime Adapters:** UEFN, Unity, UNIGINE, Web, Standalone
- **Agent Interface:** qFoldIT MCP ecosystem
- **Public Projection:** qfoldit.github.io / STATE

## Authority boundaries

Scientific validation is authoritative only at the scientific validation layer. Runtime feedback is an interaction signal. Commercial reward decisions are governed by separate policy. Public STATE is a safe projection rather than the internal system of record.

## Contract family

The platform uses versioned contracts including:

- `qfoldit.mission/1.0`
- `qfoldit.scientific-state/1.0`
- `qfoldit.submission/1.0`
- `qfoldit.evidence/1.0`
- `qfoldit.contribution-record/1.0`
- `qfoldit.uag/1.0`
- `qfoldit.engine-adapter/1.0`
- `qfoldit.event/1.0`

## Runtime portability

A scientific mission targets canonical contracts first. A capability registry then selects a compatible runtime adapter. This allows UEFN, Unity, UNIGINE, Web and future engines to evolve independently while preserving mission semantics and scientific provenance.
