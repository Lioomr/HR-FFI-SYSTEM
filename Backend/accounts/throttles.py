from rest_framework.throttling import SimpleRateThrottle

from .security import get_client_ip


class LoginRateThrottle(SimpleRateThrottle):
    scope = "login"

    def get_cache_key(self, request, view):
        ident = get_client_ip(request)
        return self.cache_format % {"scope": self.scope, "ident": ident}
