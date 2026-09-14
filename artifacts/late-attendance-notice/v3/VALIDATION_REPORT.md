# Late Attendance Notice v3 Validation Report

## Scope

This report covers only `artifacts/late-attendance-notice/v3`. V1 and v2 assets, deployed templates, backend code, and frontend code were not modified.

## Results

- Every v3 blank template is one A4 page and preserves the v2 field coordinates, accent colors, titles, policy wording, and open manual HR signature line.
- The v2 logo placeholder text was removed from each PDF content stream. Each v3 logo slot is a clean, opaque #F8FAFC rounded surface with no printed English or Arabic logo label.
- All maps use `version: 3` and `asset_revision: 3`. `company_logo` remains a supported `kind: image` field using `contain` sizing.
- `hr_signature_image` remains the sole manual-only field, is blank in all QA files, and has `auto_sign: false`.
- Transparent and opaque PNG logo QA samples both rendered cleanly. Dynamic values were rendered through the existing map-driven renderer and visually checked centered in their declared grey fields.

## Outputs and visual QA

### Level 1

- Blank template: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/late_attendance_level_1_blank_v3.pdf`
- Field map: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/late_attendance_level_1_field_map_v3.json`
- Transparent-logo QA PDF: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/late_attendance_level_1_qa_sample_v3.pdf`
- Transparent-logo QA preview: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/qa-render-v3.png`
- Opaque-logo QA PDF: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/late_attendance_level_1_qa_opaque_v3.pdf`
- Opaque-logo QA preview: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/qa_opaque-render-v3.png`
- Declared fields: `company_logo, company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, penalty_percentage, policy_result, penalty_amount, reason, hr_signature_image, company_phone, company_address, company_website, company_email`
- Required keys: `company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, policy_result, penalty_percentage, penalty_amount, reason`
- Visual QA: clean text-free opaque logo slot; transparent and opaque logos legible; centered dynamic values; HR signature line open and blank.

### Level 2

- Blank template: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/late_attendance_level_2_blank_v3.pdf`
- Field map: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/late_attendance_level_2_field_map_v3.json`
- Transparent-logo QA PDF: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/late_attendance_level_2_qa_sample_v3.pdf`
- Transparent-logo QA preview: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/qa-render-v3.png`
- Opaque-logo QA PDF: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/late_attendance_level_2_qa_opaque_v3.pdf`
- Opaque-logo QA preview: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/qa_opaque-render-v3.png`
- Declared fields: `company_logo, company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, penalty_percentage, policy_result, penalty_amount, reason, hr_signature_image, company_phone, company_address, company_website, company_email`
- Required keys: `company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, policy_result, penalty_percentage, penalty_amount, reason`
- Visual QA: clean text-free opaque logo slot; transparent and opaque logos legible; centered dynamic values; HR signature line open and blank.

### Level 3

- Blank template: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/late_attendance_level_3_blank_v3.pdf`
- Field map: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/late_attendance_level_3_field_map_v3.json`
- Transparent-logo QA PDF: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/late_attendance_level_3_qa_sample_v3.pdf`
- Transparent-logo QA preview: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/qa-render-v3.png`
- Opaque-logo QA PDF: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/late_attendance_level_3_qa_opaque_v3.pdf`
- Opaque-logo QA preview: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/qa_opaque-render-v3.png`
- Declared fields: `company_logo, company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, penalty_percentage, policy_result, penalty_amount, reason, hr_signature_image, company_phone, company_address, company_website, company_email`
- Required keys: `company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, policy_result, penalty_percentage, penalty_amount, reason`
- Visual QA: clean text-free opaque logo slot; transparent and opaque logos legible; centered dynamic values; HR signature line open and blank.

### Level 4

- Blank template: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/late_attendance_level_4_blank_v3.pdf`
- Field map: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/late_attendance_level_4_field_map_v3.json`
- Transparent-logo QA PDF: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/late_attendance_level_4_qa_sample_v3.pdf`
- Transparent-logo QA preview: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/qa-render-v3.png`
- Opaque-logo QA PDF: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/late_attendance_level_4_qa_opaque_v3.pdf`
- Opaque-logo QA preview: `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/qa_opaque-render-v3.png`
- Declared fields: `company_logo, company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, penalty_percentage, policy_result, penalty_amount, reason, hr_signature_image, company_phone, company_address, company_website, company_email`
- Required keys: `company_name, company_name_ar, notice_reference, issue_timestamp, employee_name, employee_code, department, position, violation_date, scheduled_shift_start, actual_first_check_in, minutes_late, occurrence_number, policy_result, penalty_percentage, penalty_amount, reason`
- Visual QA: clean text-free opaque logo slot; transparent and opaque logos legible; centered dynamic values; HR signature line open and blank.

## SHA-256

- `e8def8393f43a1cb5409175d086d4a9a339676ae984371167853f45d0232afdb`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/late_attendance_level_1_blank_v3.pdf`
- `0b6f09e218c550b47ff0667d01b0f463134c9386a488a6b1fd0c4fbfe5a2f8ef`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/late_attendance_level_1_field_map_v3.json`
- `5eb1fa315c98435ef690674f8a35e7a1d7b47087ba53351af74f6679b073d020`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/late_attendance_level_1_qa_sample_v3.pdf`
- `af41905ef405fede78c3c4e21971a9fd21825ed1fe9b8c25ba3f0786f786a761`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/qa-render-v3.png`
- `23f137a012febff0aba12ea121cf857a8b1bb888af24b8d17322a769dcf6b8b6`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/late_attendance_level_1_qa_opaque_v3.pdf`
- `c31c37812fd00067bf7798d8638214b915283fe0568bd386aac06af0034d29ba`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-1/qa_opaque-render-v3.png`
- `0f476f81ce98dcb3fa94484aa1f8444557cb0f268a3dbcc02f519fec0bd1a89b`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/late_attendance_level_2_blank_v3.pdf`
- `9f9b442ba58fed8edeea42045a2814b9795848e1b0c7fed1e45b8a2477c57bb9`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/late_attendance_level_2_field_map_v3.json`
- `291625da9c6c73cde8184ebd4d4bf694feb947a437df762321317f0664ced591`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/late_attendance_level_2_qa_sample_v3.pdf`
- `5f808607ff5249076435e56af1aeccaede6abff348c9f6aa6aaeb0d8052641d5`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/qa-render-v3.png`
- `5cff8cf5affeb374a5872d3d92b48db6b854e6a301ecb217ba42a6c605131185`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/late_attendance_level_2_qa_opaque_v3.pdf`
- `91bc49048653f2b0b41c8c5002bd5659072d5b0ba9a627d7f6c472d29249a1ed`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-2/qa_opaque-render-v3.png`
- `2e5f756f93e11b08497351a41eb9f041d2d46111cd2517d3060392887105a04f`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/late_attendance_level_3_blank_v3.pdf`
- `8944b3392859f804c2d8fcd2c22eca9ad77cdc9a398062ef509aafc2614ab6e7`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/late_attendance_level_3_field_map_v3.json`
- `a51ca5a484cd6809378697918468fa29a221a86f64653d0f062835dd920aaf80`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/late_attendance_level_3_qa_sample_v3.pdf`
- `6d1c116c75177eb3dd60cf0c50707f2f836e6fa7aa5cac346125303cfdb22598`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/qa-render-v3.png`
- `7afffcf74958d356ee7b81eabdd314e7f79a2b25f2dd4d86a75d704136591d1a`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/late_attendance_level_3_qa_opaque_v3.pdf`
- `aeda5e8f83fffa5b49ceb7c342aa3a4641c261dbfb544176177dcf817bc9cc23`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-3/qa_opaque-render-v3.png`
- `33821ff03c0f6891acea29a9b79c3212101b95c09169ec442293ea948d3b79af`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/late_attendance_level_4_blank_v3.pdf`
- `d464fdfe385469ca569d9aee0e6c079edf3886854dcb7ed7a631685822c0c519`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/late_attendance_level_4_field_map_v3.json`
- `ee96abd0b0c325022f1951fb263b3894f4bd97fa5abf9ecdc0691392c025c1f4`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/late_attendance_level_4_qa_sample_v3.pdf`
- `c6b1f31560e0e7b80d232d88f26be2f8071503fe4d2c977650cf7961e2b50d54`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/qa-render-v3.png`
- `b75dccf799cb508612f4fac8a11cc682836ba9b70a3668cc725d342c18e4072e`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/late_attendance_level_4_qa_opaque_v3.pdf`
- `1e298dea5777ef46a282da0eec4b44175c51cd34f8cc439f84b50052b5a23b05`  `D:/HR-FFI-SYSTEM/artifacts/late-attendance-notice/v3/level-4/qa_opaque-render-v3.png`
