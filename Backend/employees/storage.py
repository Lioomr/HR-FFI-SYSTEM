from django.conf import settings
from django.core.files.storage import FileSystemStorage


class PrivateUploadStorage(FileSystemStorage):
    def __init__(self, *args, **kwargs):
        location = getattr(settings, "PRIVATE_UPLOAD_ROOT", None)
        super().__init__(location=location, *args, **kwargs)
