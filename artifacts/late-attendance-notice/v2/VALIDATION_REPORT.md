# Late Attendance Notice v2 Validation Report

## Scope

This report covers only the v2 asset package under `artifacts/late-attendance-notice/v2`. No application code or deployed template was modified.

## Results

- All four blank PDFs are one-page A4 files.
- All four maps parse as JSON, use template version `2` with asset revision `2`, and use a bottom-left point coordinate origin.
- Each map documents every field's coordinates, font size, direction, type, required/manual status and, for image fields, image settings; required input keys are listed per level below.
- The approved `minimal_open_signature` treatment removes the colored status panel and Level block, uses larger value fields, and retains the distinct level accent in the localized subtitle.
- Every mapped dynamic text field is drawn from the same rectangle used to paint its grey placeholder. The QA samples are rendered through `core.pdf_forms.render_mapped_form`, so their values use the actual map-driven overlay path.
- `company_logo` is supported as a `kind: image` map field with contain sizing. QA places a non-FFI sample company logo in the zone.
- The centered HR signature image zone is blank in every QA sample, has no printed box, and is manual-only with `auto_sign: false`.
- The bilingual static policy copy is visible in every template: Level 1 has no deduction; Levels 2, 3, and 4 show 5%, 10%, and 50% daily-rate deductions.

## Outputs and checksums

### Level 1

- Blank template: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-1/late_attendance_level_1_blank_v2.pdf`
- Field map: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-1/late_attendance_level_1_field_map_v2.json`
- Rendered QA sample: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-1/late_attendance_level_1_qa_sample_v2.pdf`
- QA raster preview at 1.5x: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-1/qa-render-v2.png`
- Declared fields: `company_logo, company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, penalty_percentage, policy_result, penalty_amount, reason, hr_signature_image, company_phone, company_address, company_website, company_email`
- Required keys: `company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, policy_result, penalty_percentage, penalty_amount, reason`
- Visual QA: values were rendered through the map-driven overlay and inspected inside their grey fields; the company logo is present and the centered HR signature space is open and blank.

### Level 2

- Blank template: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-2/late_attendance_level_2_blank_v2.pdf`
- Field map: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-2/late_attendance_level_2_field_map_v2.json`
- Rendered QA sample: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-2/late_attendance_level_2_qa_sample_v2.pdf`
- QA raster preview at 1.5x: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-2/qa-render-v2.png`
- Declared fields: `company_logo, company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, penalty_percentage, policy_result, penalty_amount, reason, hr_signature_image, company_phone, company_address, company_website, company_email`
- Required keys: `company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, policy_result, penalty_percentage, penalty_amount, reason`
- Visual QA: values were rendered through the map-driven overlay and inspected inside their grey fields; the company logo is present and the centered HR signature space is open and blank.

### Level 3

- Blank template: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-3/late_attendance_level_3_blank_v2.pdf`
- Field map: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-3/late_attendance_level_3_field_map_v2.json`
- Rendered QA sample: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-3/late_attendance_level_3_qa_sample_v2.pdf`
- QA raster preview at 1.5x: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-3/qa-render-v2.png`
- Declared fields: `company_logo, company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, penalty_percentage, policy_result, penalty_amount, reason, hr_signature_image, company_phone, company_address, company_website, company_email`
- Required keys: `company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, policy_result, penalty_percentage, penalty_amount, reason`
- Visual QA: values were rendered through the map-driven overlay and inspected inside their grey fields; the company logo is present and the centered HR signature space is open and blank.

### Level 4

- Blank template: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-4/late_attendance_level_4_blank_v2.pdf`
- Field map: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-4/late_attendance_level_4_field_map_v2.json`
- Rendered QA sample: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-4/late_attendance_level_4_qa_sample_v2.pdf`
- QA raster preview at 1.5x: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-4/qa-render-v2.png`
- Declared fields: `company_logo, company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, penalty_percentage, policy_result, penalty_amount, reason, hr_signature_image, company_phone, company_address, company_website, company_email`
- Required keys: `company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, policy_result, penalty_percentage, penalty_amount, reason`
- Visual QA: values were rendered through the map-driven overlay and inspected inside their grey fields; the company logo is present and the centered HR signature space is open and blank.

## SHA-256

- `d30de7c96481d8a7fb66e07fb6c94b393d31fdb94e76beb6fe90ad2a3810c610`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-1/late_attendance_level_1_blank_v2.pdf`
- `1de3f57e8566a847f882a543cd36ca1532319bd5178c528af94428ceaa801928`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-1/late_attendance_level_1_field_map_v2.json`
- `4bcbfb18241db0e21eb0a74178fdb9b6ea7ad1a758a79f08363b2282b8ecd22f`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-1/late_attendance_level_1_qa_sample_v2.pdf`
- `e27f0a56b3442ab6645ef9685623a1ff38d3d66c45bb71df24553c4c1ec21a85`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-1/qa-render-v2.png`
- `d831214156cb313e2b75a88880f36b15b5ca280674841c6d204cb425482ee992`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-2/late_attendance_level_2_blank_v2.pdf`
- `82756d079bd6fe011aba5220ad64c9fe5ec187359780cefa795edf1dd7f53f32`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-2/late_attendance_level_2_field_map_v2.json`
- `791f360e8efd7a3e03336c3be59e77b3a11e63887c387b8b66f951a888adda1c`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-2/late_attendance_level_2_qa_sample_v2.pdf`
- `0419a0771912b8a4b560bef942aab3d3c14599fdac9a3e9b5f974dab7babbbff`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-2/qa-render-v2.png`
- `f37b11fde211db7189c77377671382d09e37f401aafd4cb7bc79debfda375844`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-3/late_attendance_level_3_blank_v2.pdf`
- `d6a62b3bbd770471b3fac5b56fa175e8b8b136d6739d4027b6ef5033167345b6`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-3/late_attendance_level_3_field_map_v2.json`
- `affb4e70342f62f1615907bfa189ca480ccab37ac84ca9f9eee93b0ac3cd3bb4`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-3/late_attendance_level_3_qa_sample_v2.pdf`
- `11077bb950d7f76186255c274acaeaa9e817944362d96501937e4786b6ad0f97`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-3/qa-render-v2.png`
- `6a1fe470bfa2bcde0c794973d66fa88fb31625bbf1c21ce5c5bf5fae8ab2230d`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-4/late_attendance_level_4_blank_v2.pdf`
- `fe6a169f8285d87eeb804e739d25307b485774d4d39a8811e183953add63906e`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-4/late_attendance_level_4_field_map_v2.json`
- `8fa5874beeabe5dd02414b763651a3f34220e52f530a9744945e9061531d9ca0`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-4/late_attendance_level_4_qa_sample_v2.pdf`
- `840a380b9c98d8008a71df21a9836a49fc2ded9a8311762e57222073a3365981`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v2/level-4/qa-render-v2.png`
