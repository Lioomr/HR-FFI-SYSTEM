# Workflow Stage Reseed TDD Evidence

## Source plan

The implementation context came from
`C:\Users\Asus\.claude\plans\new-feature-employee-soft-sparkle.md` and the follow-up stage-reseed defect report.
The plan was treated as product context; repository test, migration, and validation commands were selected from the
project's own configuration.

## User journeys

- As an HR user, I can trigger a contract-rating workflow after a template change without receiving a database error.
- As an operator, I can deploy a template correction and have the workflow definition repaired during migration.
- As a workflow maintainer, I can remove a stage from any template and have the obsolete database row pruned.
- As an approver, I see the current stage derived from the domain status after the next workflow sync, even if the
  stored workflow instance referenced a removed stage.

## Task report

### RED

Command:

```text
pytest -q core/test_workflow_definition_sync.py contract_ratings/tests/test_workflow_projection.py
```

Result before the production fix: `2 failed, 1 passed`.

- `test_reseeds_after_template_stages_change` failed with
  `core_wfstage_unique_definition_order` for `(definition_id, order)=(..., 0)`.
- `test_reseed_prunes_obsolete_stages_for_every_workflow` failed because the obsolete leave stage remained.
- The stale-instance projection test passed, confirming that `sync_workflow()` already replaces `current_stage` from
  the contract-rating status adapter.

Checkpoint: `db140aa0 test: reproduce workflow stage reseed conflicts`.

### GREEN

The stage synchronizer now deletes obsolete keys, parks surviving orders by 1000, and then uses
`update_or_create(definition, key)` inside one transaction. Migration `core.0009` invokes the same synchronizer for
`contract_rating` during deployment.

Focused command:

```text
pytest -q core/test_workflow_definition_sync.py contract_ratings/tests/test_workflow_projection.py
```

Result: `3 passed in 0.68s`.

Broad command:

```text
pytest -q core contract_ratings --ignore=core/tests_pdf_forms.py
```

Result: `337 passed, 12 warnings, 11 subtests passed in 135.42s`.

The unfiltered broad run produced `392 passed` and one unrelated existing failure in
`core/tests_pdf_forms.py::test_no_bundled_template_is_left_without_a_map_by_accident` because
`employee_evaluation_blank.pdf` is not registered in that PDF inventory test.

Checkpoint: `875316c3 fix: reseed workflow stages without order collisions`.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | A legacy `responses(0), hr(1), ceo(2)` layout becomes `hr_gate(0), responses(1), ceo(2)` without a uniqueness collision | `core/test_workflow_definition_sync.py::test_reseeds_after_template_stages_change` | Database integration | PASS |
| 2 | Running the repaired seeder twice leaves the same canonical stage layout | `core/test_workflow_definition_sync.py::test_reseeds_after_template_stages_change` | Database integration | PASS |
| 3 | Obsolete stage keys are pruned for workflows other than contract ratings | `core/test_workflow_definition_sync.py::test_reseed_prunes_obsolete_stages_for_every_workflow` | Database integration | PASS |
| 4 | A workflow instance stored at removed stage `hr` is projected back to `hr_gate` from rating status on sync | `contract_ratings/tests/test_workflow_projection.py::test_sync_workflow_replaces_stale_removed_stage_from_rating_status` | Workflow integration | PASS |
| 5 | Django configuration and models remain valid | `python manage.py check`; `python manage.py makemigrations --check --dry-run` | Configuration | PASS |
| 6 | Edited Python files satisfy Ruff lint and format checks | `ruff check`; `ruff format --check` | Static analysis | PASS |

## Coverage and known gaps

Neither the repository virtual environment nor the backend container has `coverage`/`pytest-cov` installed, so a
numeric coverage report could not be generated without changing dependencies. The focused tests execute every new
stage-sync branch, including pruning, parking, updating, creating, repeat seeding, and stale-instance reprojection.
The unrelated PDF inventory failure remains outside this backend workflow change.

## Merge evidence

- RED: `db140aa0` — two intended failures reproduced; stale-stage repair behavior confirmed.
- GREEN: `875316c3` — focused tests passed after the transactional parking fix and deploy migration.
