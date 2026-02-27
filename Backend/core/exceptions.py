from django.http import Http404
from django.utils.translation import get_language
from rest_framework.exceptions import ValidationError, ErrorDetail
from rest_framework.views import exception_handler

from core.error_translations import ARABIC_ERRORS
from core.responses import error


def _translate_if_arabic(data):
    """
    Recursively scans strings inside lists/dicts and translates them
    if the current language is Arabic and they match our dictionary.
    Also handles partial matches for 'exceeds remaining balance' types.
    """
    if get_language() != "ar":
        return data

    if isinstance(data, (str, ErrorDetail)):
        string_val = str(data)
        for eng_key, ar_val in ARABIC_ERRORS.items():
            if eng_key in string_val:
                return string_val.replace(eng_key, ar_val)
        return string_val
    elif isinstance(data, list):
        return [_translate_if_arabic(item) for item in data]
    elif isinstance(data, dict):
        result = {}
        for k, v in data.items():
            translated_k = _translate_if_arabic(k) if isinstance(k, str) else k
            result[translated_k] = _translate_if_arabic(v)
        return result
    return data


def custom_exception_handler(exc, context):
    if isinstance(exc, Http404):
        msg = _translate_if_arabic("Not found")
        return error(msg, status=404)

    resp = exception_handler(exc, context)

    if resp is None:
        msg = _translate_if_arabic("Server error")
        return error(msg, status=500)

    if isinstance(exc, ValidationError):
        msg = _translate_if_arabic("Validation error")
        translated_errors = _translate_if_arabic(resp.data)
        return error(msg, errors=translated_errors, status=422)

    message = "Request failed"
    if isinstance(resp.data, dict) and "detail" in resp.data:
        message = str(resp.data["detail"])

    msg = _translate_if_arabic(message)
    return error(msg, status=resp.status_code)

