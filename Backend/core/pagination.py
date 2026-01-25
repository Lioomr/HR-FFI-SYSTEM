from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

class StandardPagination(PageNumberPagination):
    page_size_query_param = "page_size"
    page_query_param = "page"

    def get_paginated_response(self, data):
        return Response({
            "status": "success",
            "data": {
                "items": data,
                "page": self.page.number,
                "page_size": self.get_page_size(self.request),
                "count": self.page.paginator.count,
                "total_pages": self.page.paginator.num_pages,
            }
        })


class EmployeePagination(PageNumberPagination):
    page_size_query_param = "page_size"
    page_query_param = "page"

    def get_paginated_response(self, data):
        return Response({
            "status": "success",
            "data": {
                "results": data,
                "count": self.page.paginator.count,
            }
        })
