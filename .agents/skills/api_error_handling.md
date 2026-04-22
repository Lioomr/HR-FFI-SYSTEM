# API Error Handling Skill

Use for backend/frontend error contract work.

Backend:
- Return standard error envelopes from the API plan.
- Surface serializer validation clearly.
- Use appropriate HTTP status codes.
- Keep internal exception details out of client responses.

Frontend:
- Normalize API errors in the API service layer when possible.
- Show field-level form errors where available.
- Show page-level errors for load failures.
- Keep retry/reload paths obvious for users.
