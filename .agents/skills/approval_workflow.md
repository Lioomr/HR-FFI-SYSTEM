# Approval Workflow Skill

Use when implementing or modifying multi-stage approval flows (leaves, loans, assets, or new domains).

Read `.agents/context/workflow_engine.md` first.

## Checklist

### Backend

- [ ] A `WorkflowDefinition` exists (or needs creating via data migration) for the flow.
- [ ] `WorkflowStageDefinition` rows define the stage sequence with correct role requirements.
- [ ] On request creation: create `WorkflowInstance` linked to the new request object.
- [ ] On each approval/rejection: call `advance_workflow(instance, actor, decision, comment)`.
- [ ] Before action: call `can_actor_approve(user, instance)` — return 403 if false.
- [ ] Each stage transition emits an `AuditLog` entry (action: `<entity>_approved` / `<entity>_rejected`).
- [ ] On final approval: update parent request `status` to APPROVED/REJECTED.
- [ ] Delegation rules are checked when resolving next approver.
- [ ] Notify next approver (Bird notification service if configured).

### State Machine

Define the full set of allowed status values:
- `PENDING_MGR` → `PENDING_HR` → `PENDING_CEO` → `APPROVED` / `REJECTED`
- Early rejection at any stage goes directly to `REJECTED`.
- Do not allow clients to directly set `status` — only internal workflow service can.

### API

- `POST /<resource>/<id>/approve/` — `@action(detail=True, methods=['post'])`
- `POST /<resource>/<id>/reject/` — `@action(detail=True, methods=['post'])`
- Request body: `{ "comment": "..." }` (optional reason)
- Response: updated resource serialization

### Frontend

- Inbox page: fetch items filtered by `status=PENDING_<ROLE>` for the current user's role.
- Detail page: show approve/reject buttons only when `can_approve` is true (returned by API).
- After decision: re-fetch the resource to reflect updated status and workflow history.
- Show workflow history (all `WorkflowAction` entries in order) in the detail view.
- Handle the case where the item was already actioned by someone else (stale state).

### Tests

- Test: actor at each stage can approve/reject.
- Test: actor at the wrong stage gets 403.
- Test: final approval sets status to APPROVED.
- Test: rejection at any stage sets status to REJECTED and stops the chain.
- Test: delegation — delegatee can act within valid date range, not outside it.
