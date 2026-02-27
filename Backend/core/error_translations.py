"""
Custom mapping for backend validation strings that cannot be translated safely via 
Django's makemessages on Windows.

When `Accept-Language: ar` is sent by the client, the `custom_exception_handler` 
will use this dictionary to recursively translate matching strings in the error payload.
"""

ARABIC_ERRORS = {
    # Leave Validation - Annual
    "Annual leave can be used only after completing 9 months of service.": "يمكن استخدام الإجازة السنوية فقط بعد إكمال 9 أشهر من الخدمة.",
    "Annual leave exceeds remaining balance ": "تتجاوز الإجازة السنوية الرصيد المتبقي ",

    # Leave Validation - General Dates
    "End date must be after start date.": "يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.",
    "Requested leave duration must be at least 1 day.": "يجب أن تكون مدة الإجازة المطلوبة يومًا واحدًا على الأقل.",
    "You already have a pending or approved leave request for this period.": "لديك بالفعل طلب إجازة معلق أو معتمد لهذه الفترة.",
    "You already have a pending or approved leave request for this period": "لديك بالفعل طلب إجازة معلق أو معتمد لهذه الفترة",

    # Leave Validation - Specific Types
    "Sick leave requires a medical report document.": "تتطلب الإجازة المرضية إرفاق تقرير طبي.",
    "Sick leave request exceeds annual maximum of 120 days.": "يتجاوز طلب الإجازة المرضية الحد الأقصى السنوي البالغ 120 يومًا.",
    "Sick leave exceeds annual maximum. Remaining: ": "تتجاوز الإجازة المرضية الحد الأقصى السنوي. المتبقي: ",
    "Exceptional leave exceeds annual maximum. Remaining: ": "تتجاوز الإجازة الاستثنائية الحد الأقصى السنوي. المتبقي: ",
    "Emergency leave exceeds remaining balance ": "تتجاوز إجازة الطوارئ الرصيد المتبقي ",
    "Marriage leave maximum is 5 days.": "الحد الأقصى لإجازة الزواج هو 5 أيام.",
    "Marriage leave is allowed once during service.": "يُسمح بإجازة الزواج مرة واحدة فقط خلال فترة الخدمة.",
    "Death leave maximum is 5 days.": "الحد الأقصى لإجازة الوفاة هو 5 أيام.",
    "Birth leave maximum is 3 days.": "الحد الأقصى لإجازة المولود هو 3 أيام.",
    "Maternity extension maximum is 30 days unpaid.": "الحد الأقصى لتمديد إجازة الأمومة هو 30 يومًا غير مدفوعة الأجر.",
    
    # Files
    "Unsupported file type.": "نوع الملف غير مدعوم.",
    "File size exceeds maximum limit.": "حجم الملف يتجاوز الحد الأقصى المسموح به.",
    
    # Other common backend messages we know of
    "Employee is not connected to a system user account.": "الموظف غير مرتبط بحساب مستخدم في النظام.",
    "Employee Profile not found.": "لم يتم العثور على ملف تعريف الموظف.",
    "Leave type is inactive.": "نوع الإجازة غير نشط.",
    "Invalid credentials": "بيانات الاعتماد غير صالحة.",
    "Request failed": "فشل الطلب",
    "Server error": "خطأ في الخادم",
    "Not found": "غير موجود",
    "Validation error": "خطأ في التحقق من صحة البيانات",
    "non_field_errors": "أخطاء عامة",
}
