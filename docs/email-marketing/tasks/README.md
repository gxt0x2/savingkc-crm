# Implementation packets

Specification v1.2 · Design only. Start after implementation is authorized.

Read [07](../07-sales-voice-and-response-operations.md) for the current sales voice, personalization, scheduling, alert and phone contracts. Read [08](../08-focused-workspace-and-cadence.md) for current navigation, inbox views, campaign recipients and cadence. EM-031–EM-035 run before final EM-030 release verification.

Run one packet at a time on an isolated implementation checkout unless independent parallel work is explicitly authorized. Dependencies are completion/evidence requirements, not suggestions. Do not start a dependent remote-integration claim while its required provider evidence is blocked. Independent work may continue with that limitation recorded.

The command, data and page specifications are shared contracts. A packet cannot invent a new Lead definition, implicit purchase, stage mapping or remote retry behavior. If the current repository differs, record the evidence in EM-001 and make one explicit contract revision before dependent code.

| Packet | Outcome | Dependencies |
| --- | --- | --- |
| [EM-001](EM-001.md) | Verify the implementation baseline | None |
| [EM-002](EM-002.md) | Create shared contracts and test harness | EM-001 |
| [EM-003](EM-003.md) | Implement workspace configuration and authorization | EM-002 |
| [EM-004](EM-004.md) | Implement email identity and property links | EM-003 |
| [EM-005](EM-005.md) | Implement immutable campaign publication | EM-004 |
| [EM-006](EM-006.md) | Implement message ledger and durable queue | EM-003, EM-005 |
| [EM-007](EM-007.md) | Implement secure service connections | EM-003, EM-006 |
| [EM-008](EM-008.md) | Implement domains and stable sender identities | EM-007 |
| [EM-009](EM-009.md) | Implement suppression and public preferences | EM-004, EM-006 |
| [EM-010](EM-010.md) | Implement dispatch guards and monetary reservations | EM-005, EM-006, EM-008, EM-009 |
| [EM-011](EM-011.md) | Implement Resend dispatch and reconciliation | EM-007, EM-008, EM-010 |
| [EM-012](EM-012.md) | Implement authentic inbound capture and correlation | EM-006, EM-008, EM-009, EM-011 |
| [EM-013](EM-013.md) | Implement thread ownership and exact draft approval | EM-010, EM-012 |
| [EM-014](EM-014.md) | Bridge email Leads, acquisition handoffs and CRM history | EM-004, EM-012, EM-013 |
| [EM-015](EM-015.md) | Implement bounded AI inference and policy guards | EM-007, EM-010, EM-012, EM-013, EM-014 |
| [EM-016](EM-016.md) | Implement repeatable AI evaluations and publication | EM-015 |
| [EM-017](EM-017.md) | Prove the first complete configured email journey | EM-005, EM-011, EM-012, EM-013, EM-014, EM-015, EM-016 |
| [EM-018](EM-018.md) | Implement imports, segments and verification jobs | EM-004, EM-005, EM-007, EM-009, EM-010 |
| [EM-019](EM-019.md) | Complete pacing, campaign interrupts and resume | EM-005, EM-010, EM-011, EM-012, EM-018 |
| [EM-020](EM-020.md) | Build Email shell, overview and complete setup | EM-003, EM-007, EM-008, EM-016, EM-017, EM-018, EM-019 |
| [EM-021](EM-021.md) | Build audience list, mapping and review pages | EM-018, EM-020 |
| [EM-022](EM-022.md) | Build campaign list, builder and live detail | EM-019, EM-020, EM-021 |
| [EM-023](EM-023.md) | Build shared inbox, composer and review | EM-013, EM-014, EM-015, EM-020 |
| [EM-024](EM-024.md) | Complete handoff page and optional calendar scheduling | EM-014, EM-020, EM-023 |
| [EM-025](EM-025.md) | Build playbook editing and evaluation review | EM-016, EM-020 |
| [EM-026](EM-026.md) | Build sending, settings and brand pages | EM-007, EM-008, EM-009, EM-010, EM-020 |
| [EM-027](EM-027.md) | Implement truthful reports and exports | EM-014, EM-018, EM-019, EM-020 |
| [EM-028](EM-028.md) | Close legacy sending and conversation bypasses | EM-009, EM-011, EM-013, EM-014, EM-023 |
| [EM-029](EM-029.md) | Build recovery operations, downloads and retention controls | EM-006, EM-012, EM-020, EM-026, EM-027 |
| [EM-031](EM-031.md) | Add controlled per-recipient copy and everyday Black Swan voice | EM-015, EM-016, EM-018, EM-022 |
| [EM-032](EM-032.md) | Add targeted phone and callback alerts with acknowledgment | EM-012, EM-014, EM-023, EM-029 |
| [EM-033](EM-033.md) | Automate agreed callbacks and correct the no-response cadence | EM-019, EM-024, EM-032 |
| [EM-034](EM-034.md) | Connect one stable email-response phone line | EM-024, EM-026, EM-028, EM-032 |
| [EM-035](EM-035.md) | Reconcile focused workspace, saved views and campaign cadence | EM-020, EM-021, EM-022, EM-023, EM-024, EM-027, EM-033 |
| [EM-030](EM-030.md) | Verify the complete product and prepare a bounded release | EM-017, EM-021, EM-022, EM-023, EM-024, EM-025, EM-026, EM-027, EM-028, EM-029, EM-031, EM-032, EM-033, EM-034, EM-035 |

For a smaller coding model, open the selected packet, its named source sections and existing affected code. Complete the bounded behavior, run its checks, report the diff and evidence, then stop at the packet boundary. Do not ask it to build the entire application from this index. Do not use model size as a substitute for review of identity, security, migrations, concurrency and remote side effects.

