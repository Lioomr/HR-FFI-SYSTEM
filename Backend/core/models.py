from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models


class WorkflowDefinition(models.Model):
    key = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=150)
    module_key = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["module_key", "key"]

    def __str__(self) -> str:
        return self.name


class WorkflowStageDefinition(models.Model):
    definition = models.ForeignKey(WorkflowDefinition, on_delete=models.CASCADE, related_name="stages")
    key = models.CharField(max_length=100)
    title = models.CharField(max_length=150)
    approver_role = models.CharField(max_length=50, blank=True, default="")
    order = models.PositiveSmallIntegerField()
    is_optional = models.BooleanField(default=False)
    is_terminal = models.BooleanField(default=False)
    condition_key = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["definition_id", "order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["definition", "key"], name="core_wfstage_unique_definition_key"),
            models.UniqueConstraint(fields=["definition", "order"], name="core_wfstage_unique_definition_order"),
        ]

    def __str__(self) -> str:
        return f"{self.definition.key}:{self.key}"


class WorkflowInstance(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        IN_REVIEW = "in_review", "In Review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    definition = models.ForeignKey(WorkflowDefinition, on_delete=models.PROTECT, related_name="instances")
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    content_object = GenericForeignKey("content_type", "object_id")

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    current_stage = models.CharField(max_length=100, blank=True, default="")
    current_approver_role = models.CharField(max_length=50, blank=True, default="")
    current_actor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="workflow_assignments",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="submitted_workflows",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["content_type", "object_id"], name="core_wfinstance_unique_object")
        ]
        indexes = [
            models.Index(fields=["status", "current_approver_role"], name="core_wfins_stat_role_idx"),
            models.Index(fields=["content_type", "object_id"], name="core_wfins_obj_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.definition.key}:{self.object_id}"


class WorkflowAction(models.Model):
    class Action(models.TextChoices):
        SUBMIT = "submit", "Submit"
        APPROVE = "approve", "Approve"
        REJECT = "reject", "Reject"
        CANCEL = "cancel", "Cancel"
        ADVANCE = "advance", "Advance"
        REASSIGN = "reassign", "Reassign"
        SKIP = "skip", "Skip"
        OVERRIDE = "override", "Override"
        DISBURSE = "disburse", "Disburse"
        DEDUCT = "deduct", "Deduct"

    workflow = models.ForeignKey(WorkflowInstance, on_delete=models.CASCADE, related_name="actions")
    action = models.CharField(max_length=20, choices=Action.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="workflow_actions",
    )
    approver_role = models.CharField(max_length=50, blank=True, default="")
    from_status = models.CharField(max_length=20, blank=True, default="")
    to_status = models.CharField(max_length=20, blank=True, default="")
    from_stage = models.CharField(max_length=100, blank=True, default="")
    to_stage = models.CharField(max_length=100, blank=True, default="")
    note = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["workflow", "created_at"], name="core_wfact_wf_created_idx"),
            models.Index(fields=["action"], name="core_wfact_action_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.workflow_id}:{self.action}"


class DelegationRule(models.Model):
    from_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="delegations_given",
    )
    to_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="delegations_received",
    )
    start_at = models.DateTimeField()
    end_at = models.DateTimeField(null=True, blank=True)
    reason = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delegation_rules_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        indexes = [
            models.Index(fields=["from_user", "is_active"], name="core_del_from_act_idx"),
            models.Index(fields=["to_user", "is_active"], name="core_del_to_act_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.from_user_id}->{self.to_user_id}"


class UserPreference(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="preferences",
    )
    scope = models.CharField(max_length=100)
    key = models.CharField(max_length=100)
    value = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scope", "key", "id"]
        constraints = [
            models.UniqueConstraint(fields=["user", "scope", "key"], name="core_userpref_unique_user_scope_key")
        ]
        indexes = [
            models.Index(fields=["user", "scope"], name="core_userpref_user_scope_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.scope}:{self.key}"
