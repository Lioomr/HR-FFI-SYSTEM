# Excel Import Template

This directory contains the official Excel template for bulk employee import.

## File
- `employee_import_template.xlsx` - Company-approved template with correct headers and format

## Usage
- Template is served via `/api/employees/import-template` endpoint
- HR staff can download this template from the Import Employees page
- Template ensures correct header format and prevents import errors

## Deployment
- This directory should be included in version control
- Template file will be deployed with the application
- In production, can be served directly by nginx/Apache for better performance

## Updating Template
To update the template:
1. Replace `employee_import_template.xlsx` with the new version
2. Ensure headers match `EXPECTED_IMPORT_HEADERS` in `employees/views.py`
3. Test import functionality after updating
4. Commit changes to version control
