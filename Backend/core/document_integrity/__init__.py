"""Tamper-evident approved documents: freeze, hash, seal, sign, and verify.

Public entry points live in :mod:`core.document_integrity.services`; a domain
module registers how to render and describe its document in
:mod:`core.document_integrity.registry`. Keep this package ``__init__`` free of
imports: ``core.models`` imports the models module during app loading.

Rollout recipe for another request type (full version with tests:
``plans/Document Signing API Handoff.md`` - "How to add a new document type"):

1. ``register_document_type(DocumentType(...))`` with ``render``, ``reference``,
   ``company``, ``stage_signers`` and ``can_access`` callables (see
   ``leaves/document_integrity.py``, ``loans/document_integrity.py``).
2. Call ``services.record_stage_approval`` after each approval transition and
   ``services.schedule_finalize`` when the request reaches its final state.
3. In the PDF download view return ``api.frozen_pdf_response(...)``.
4. Mix ``api.DocumentIntegrityActionsMixin`` into the viewset and implement
   ``get_integrity_object`` (usually with ``api.resolve_integrity_object``).
"""
