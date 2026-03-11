from django.utils.translation import get_language
from rest_framework.exceptions import ErrorDetail
from rest_framework.response import Response

from core.error_translations import ARABIC_ERRORS


def _normalize_422_errors(errors):
    if errors is None:
        return None
    if isinstance(errors, list):
        return errors
    if isinstance(errors, dict):
        normalized = []
        for field, messages in errors.items():
            if isinstance(messages, (list, tuple)):
                for msg in messages:
                    normalized.append({"field": field, "message": str(msg)})
            else:
                normalized.append({"field": field, "message": str(messages)})
        return normalized
    if isinstance(errors, str):
        return [{"message": errors}]
    return [{"message": str(errors)}]


def _translate_if_arabic(data):
    if get_language() != "ar":
        return data

    if isinstance(data, (str, ErrorDetail)):
        string_val = str(data)
        for eng_key, ar_val in ARABIC_ERRORS.items():
            if eng_key in string_val:
                string_val = string_val.replace(eng_key, ar_val)
        return string_val
    if isinstance(data, list):
        return [_translate_if_arabic(item) for item in data]
    if isinstance(data, dict):
        return {
            (_translate_if_arabic(key) if isinstance(key, str) else key): _translate_if_arabic(value)
            for key, value in data.items()
        }
    return data


def _extract_first_user_message(errors):
    if not errors:
        return None

    if isinstance(errors, list):
        for item in errors:
            if isinstance(item, str) and item.strip():
                return item
            if isinstance(item, dict):
                message = item.get("message")
                if isinstance(message, str) and message.strip():
                    return message
    elif isinstance(errors, dict):
        for value in errors.values():
            if isinstance(value, (list, tuple)) and value:
                first = value[0]
                if isinstance(first, str) and first.strip():
                    return first
            elif isinstance(value, str) and value.strip():
                return value

    return None


def success(data=None, message=None, status=200):
    payload = {"status": "success", "data": data if data is not None else {}}
    if message:
        payload["message"] = _translate_if_arabic(message)
    return Response(payload, status=status)


def error(message="Request failed", errors=None, status=400):
    translated_message = _translate_if_arabic(message)
    payload = {"status": "error", "message": translated_message}
    if errors is not None:
        normalized_errors = _normalize_422_errors(errors) if status == 422 else errors
        translated_errors = _translate_if_arabic(normalized_errors)
        payload["errors"] = translated_errors

        if status in {400, 422}:
            first_user_message = _extract_first_user_message(translated_errors)
            if first_user_message:
                payload["message"] = first_user_message
    return Response(payload, status=status)
